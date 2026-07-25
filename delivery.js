import { DELIVERY_CONFIG } from "./config.js";
import { safeAddListener, openSmallModal, closeSmallModal } from "./utils.js";

export function openDeliveryFor(product) {
  const configured = DELIVERY_CONFIG.enabled;
  const url = configured ? DELIVERY_CONFIG.buildSearchUrl(product.name) : null;

  if (configured && url) {
    window.open(url, "_blank", "noopener");
    return;
  }

  const titleEl = document.getElementById("delivery-modal-title");
  const textEl = document.getElementById("delivery-modal-text");
  if (titleEl) titleEl.textContent = "Партнёры пока не подключены";
  if (textEl) textEl.textContent = `Как только появится партнёрская программа доставки, эта кнопка начнёт открывать поиск «${product.name}» у партнёра.`;
  openSmallModal("delivery-modal");
}

safeAddListener("delivery-modal-close", "click", () => closeSmallModal("delivery-modal"));
