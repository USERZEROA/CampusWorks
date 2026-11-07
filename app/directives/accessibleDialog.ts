import type { ObjectDirective } from "vue";

type DialogOptions = { label: string; close: () => void };
const cleanup = new WeakMap<HTMLElement, () => void>();
const dialogs: HTMLElement[] = [];
let priorOverflow = "";

/** Keyboard behavior shared by dialogs without changing their visual layout. */
export const vAccessibleDialog: ObjectDirective<HTMLElement, DialogOptions> = {
  getSSRProps(binding) {
    return {
      role: "dialog",
      "aria-modal": "true",
      "aria-label": binding.value.label,
      tabindex: -1,
    };
  },
  mounted(element, binding) {
    const previous =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    element.setAttribute("role", "dialog");
    element.setAttribute("aria-modal", "true");
    element.setAttribute("aria-label", binding.value.label);
    element.tabIndex = -1;
    if (!dialogs.length) {
      priorOverflow = document.body.style.overflow;
      document.body.style.overflow = "hidden";
    }
    dialogs.push(element);
    const focusable = () =>
      [
        ...element.querySelectorAll<HTMLElement>(
          'button:not([disabled]),a[href],input:not([disabled]):not([type=hidden]),textarea:not([disabled]),select:not([disabled]),[tabindex]:not([tabindex="-1"])',
        ),
      ].filter((item) => item.getClientRects().length > 0);
    const focusFirst = () => (focusable()[0] || element).focus();
    const keydown = (event: KeyboardEvent) => {
      if (dialogs.at(-1) !== element) return;
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        binding.value.close();
        return;
      }
      if (event.key !== "Tab") return;
      const items = focusable();
      if (!items.length) {
        event.preventDefault();
        element.focus();
        return;
      }
      const first = items[0]!;
      const last = items.at(-1)!;
      if (
        event.shiftKey &&
        (document.activeElement === first ||
          document.activeElement === element ||
          !element.contains(document.activeElement))
      ) {
        event.preventDefault();
        last.focus();
      } else if (
        !event.shiftKey &&
        (document.activeElement === last ||
          !element.contains(document.activeElement))
      ) {
        event.preventDefault();
        first.focus();
      }
    };
    const focusin = (event: FocusEvent) => {
      if (dialogs.at(-1) === element && !element.contains(event.target as Node))
        focusFirst();
    };
    document.addEventListener("keydown", keydown, true);
    document.addEventListener("focusin", focusin);
    queueMicrotask(() => {
      if (element.isConnected) focusFirst();
    });
    cleanup.set(element, () => {
      document.removeEventListener("keydown", keydown, true);
      document.removeEventListener("focusin", focusin);
      const index = dialogs.indexOf(element);
      if (index >= 0) dialogs.splice(index, 1);
      if (!dialogs.length) document.body.style.overflow = priorOverflow;
      queueMicrotask(() => {
        if (previous?.isConnected) previous.focus();
      });
    });
  },
  updated(element, binding) {
    element.setAttribute("aria-label", binding.value.label);
  },
  beforeUnmount(element) {
    cleanup.get(element)?.();
    cleanup.delete(element);
  },
};
