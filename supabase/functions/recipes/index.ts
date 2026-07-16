// ---------------------------------------------------------------------------
// Supabase Edge Function: прокси к Spoonacular API.
//
// Зачем это отдельная функция, а не прямой вызов из app.js:
// приложение — статика без своего сервера, а значит любой ключ, вставленный
// прямо в app.js/config.js, был бы виден в devtools у любого посетителя и
// его можно было бы использовать за ваш счёт. Здесь ключ хранится как
// Supabase Secret и никогда не попадает в браузер.
//
// Деплой (один раз, через Supabase CLI):
//   supabase login
//   supabase link --project-ref <ваш-project-ref>
//   supabase functions deploy recipes
//   supabase secrets set SPOONACULAR_API_KEY=ваш_ключ_с_spoonacular.com
//
// Подробности и получение ключа — в README.md.
// ---------------------------------------------------------------------------
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SPOONACULAR_KEY = Deno.env.get("SPOONACULAR_API_KEY");
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    // Пускаем только авторизованных пользователей нашего приложения —
    // functions.invoke() на клиенте автоматически шлёт токен текущей сессии.
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "Не авторизовано" }, 401);

    const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return json({ error: "Не авторизовано" }, 401);

    // Дневной лимит на пользователя — защищает общую квоту Spoonacular
    // от одного аккаунта, который (случайно или намеренно, например через
    // devtools) шлёт запросы в цикле.
    const DAILY_LIMIT = 20;
    const today = new Date().toISOString().slice(0, 10);
    const { data: usage } = await supabase
      .from("api_usage")
      .select("count")
      .eq("user_id", user.id)
      .eq("day", today)
      .maybeSingle();
    const usedToday = usage?.count || 0;
    if (usedToday >= DAILY_LIMIT) {
      return json({ error: "Дневной лимит запросов к базе рецептов исчерпан. Попробуйте завтра." });
    }
    await supabase
      .from("api_usage")
      .upsert({ user_id: user.id, day: today, count: usedToday + 1 }, { onConflict: "user_id,day" });

    if (!SPOONACULAR_KEY) {
      return json({ error: "SPOONACULAR_API_KEY не настроен на сервере (supabase secrets set …)" });
    }

    const body = await req.json().catch(() => ({}));

    if (body.action === "search") {
      const ingredients = (Array.isArray(body.ingredients) ? body.ingredients : [])
        .slice(0, 10)
        .join(",");
      if (!ingredients) return json({ recipes: [] });

      const apiUrl = `https://api.spoonacular.com/recipes/findByIngredients` +
        `?apiKey=${SPOONACULAR_KEY}&ingredients=${encodeURIComponent(ingredients)}` +
        `&number=6&ranking=2&ignorePantry=true`;
      const res = await fetch(apiUrl);
      const data = await res.json();
      if (!res.ok) return json({ error: data?.message || "Ошибка Spoonacular API" }, 200);

      const recipes = (Array.isArray(data) ? data : []).map((r: any) => ({
        id: r.id,
        title: r.title,
        image: r.image,
        usedIngredients: (r.usedIngredients || []).map((i: any) => i.name),
        missedIngredients: (r.missedIngredients || []).map((i: any) => i.name),
      }));
      return json({ recipes });
    }

    if (body.action === "details") {
      const id = Number(body.id);
      if (!id) return json({ error: "Не указан id рецепта" }, 200);

      const apiUrl = `https://api.spoonacular.com/recipes/${id}/information` +
        `?apiKey=${SPOONACULAR_KEY}&includeNutrition=false`;
      const res = await fetch(apiUrl);
      const data = await res.json();
      if (!res.ok) return json({ error: data?.message || "Ошибка Spoonacular API" }, 200);

      const steps = (data.analyzedInstructions?.[0]?.steps || []).map((s: any) => s.step);
      return json({
        id: data.id,
        title: data.title,
        image: data.image,
        readyInMinutes: data.readyInMinutes,
        servings: data.servings,
        sourceUrl: data.sourceUrl,
        steps,
      });
    }

    return json({ error: "Неизвестное действие" }, 400);
  } catch (err) {
    console.error(err);
    return json({ error: err instanceof Error ? err.message : "Внутренняя ошибка" }, 500);
  }
});