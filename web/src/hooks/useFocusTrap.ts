import { useEffect, type RefObject } from "react";

const FOCUSABLE_SELECTOR = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  '[tabindex]:not([tabindex="-1"])',
].join(",");

function isHidden(el: HTMLElement): boolean {
  if (el.hidden || el.getAttribute("aria-hidden") === "true") return true;
  const style = el.ownerDocument.defaultView?.getComputedStyle(el);
  return style?.display === "none" || style?.visibility === "hidden";
}

function focusableElements(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(
    (el) => !isHidden(el)
  );
}

interface FocusTrapOptions {
  // When provided, Escape inside the dialog calls this, consolidating
  // close-on-Escape into the trap. Omit it to keep Escape handling elsewhere.
  onClose?: () => void;
}

// Traps keyboard focus within a dialog container while it is mounted.
// On mount: captures the previously-focused element and moves focus inside.
// While open: cycles Tab / Shift+Tab within the dialog's focusable set.
// On unmount: restores focus to the element that was focused on open.
export function useFocusTrap(ref: RefObject<HTMLElement | null>, options: FocusTrapOptions = {}) {
  const { onClose } = options;

  useEffect(() => {
    const container = ref.current;
    if (!container) return;

    const previouslyFocused = document.activeElement as HTMLElement | null;

    const initial = focusableElements(container);
    if (initial.length > 0) {
      initial[0].focus();
    } else {
      if (container.tabIndex < 0) container.tabIndex = -1;
      container.focus();
    }

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && onClose) {
        onClose();
        return;
      }
      if (e.key !== "Tab") return;
      const focusable = focusableElements(container);
      if (focusable.length === 0) {
        e.preventDefault();
        return;
      }

      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active = document.activeElement;

      if (e.shiftKey) {
        if (active === first || !container.contains(active)) {
          e.preventDefault();
          last.focus();
        }
      } else if (active === last || !container.contains(active)) {
        e.preventDefault();
        first.focus();
      }
    };

    container.addEventListener("keydown", handleKeyDown);

    return () => {
      container.removeEventListener("keydown", handleKeyDown);
      previouslyFocused?.focus();
    };
  }, [ref, onClose]);
}
