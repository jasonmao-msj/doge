import { useCallback, useEffect, useRef, type RefObject } from 'react';
import {
  loadHistoryItems,
  recordHistory,
  subscribeInputHistoryChanged,
} from '../../../hooks/useInputHistoryStore.js';

type EditableRef = RefObject<HTMLDivElement | null>;

type KeyEventLike = {
  key: string;
  metaKey?: boolean;
  ctrlKey?: boolean;
  altKey?: boolean;
  shiftKey?: boolean;
  preventDefault: () => void;
  stopPropagation: () => void;
};

const INVISIBLE_CHARS_RE = /[\u200B-\u200D\uFEFF]/g;

export interface UseInputHistoryOptions {
  editableRef: EditableRef;
  getTextContent: () => string;
  handleInput: (isComposingFromEvent?: boolean) => void;
  historyScopeKey?: string | null;
}

export interface UseInputHistoryReturn {
  record: (text: string) => void;
  handleKeyDown: (e: KeyEventLike) => boolean;
}

/**
 * Provides input history navigation for the chat input box.
 *
 * This hook is a thin navigation shell over `useInputHistoryStore` — the
 * single source of truth for input history (backed by
 * ~/.doge/inputHistory.json with localStorage interop). Recording,
 * fragmentation, and persistence all live in the store; this hook only
 * maintains the navigation cursor and re-reads the store on
 * `inputHistoryChanged` so in-session entries are visible without remount.
 *
 * Behavior:
 * - When the input is empty, `ArrowUp` cycles through previous inputs.
 * - While navigating history, `ArrowDown` moves forward; reaching the end restores the draft.
 */
export function useInputHistory({
  editableRef,
  getTextContent,
  handleInput,
  historyScopeKey = null,
}: UseInputHistoryOptions): UseInputHistoryReturn {
  const historyRef = useRef<string[]>([]);
  const historyIndexRef = useRef<number>(-1);
  const draftRef = useRef<string>('');

  useEffect(() => {
    historyRef.current = loadHistoryItems();
    historyIndexRef.current = -1;
    draftRef.current = '';
  }, [historyScopeKey]);

  useEffect(() => {
    return subscribeInputHistoryChanged(() => {
      historyRef.current = loadHistoryItems();
    });
  }, []);

  const setText = useCallback(
    (nextText: string) => {
      const el = editableRef.current;
      if (!el) return;

      try {
        el.innerText = nextText;

        // Move cursor to end
        const range = document.createRange();
        const selection = window.getSelection();
        if (selection) {
          range.selectNodeContents(el);
          range.collapse(false);
          selection.removeAllRanges();
          selection.addRange(range);
        }
      } catch {
        // Defensive: JCEF/IME edge cases can throw on DOM selection APIs.
      } finally {
        handleInput(false);
      }
    },
    [editableRef, handleInput]
  );

  const record = useCallback((text: string) => {
    recordHistory(text);
    historyRef.current = loadHistoryItems();
    historyIndexRef.current = -1;
    draftRef.current = '';
  }, []);

  const handleKeyDown = useCallback(
    (e: KeyEventLike): boolean => {
      const key = e.key;

      if (historyIndexRef.current !== -1 && key !== 'ArrowUp' && key !== 'ArrowDown') {
        historyIndexRef.current = -1;
        draftRef.current = '';
        return false;
      }

      if (key !== 'ArrowUp' && key !== 'ArrowDown') return false;
      if (e.metaKey || e.ctrlKey || e.altKey) return false;

      const items = historyRef.current;
      if (items.length === 0) return false;

      const currentText = getTextContent();
      const cleanCurrent = currentText.replace(INVISIBLE_CHARS_RE, '').trim();
      const isNavigating = historyIndexRef.current !== -1;

      // Only start history navigation when input is empty
      if (!isNavigating && cleanCurrent) return false;
      // ArrowDown only works when already navigating
      if (!isNavigating && key === 'ArrowDown') return false;

      e.preventDefault();
      e.stopPropagation();

      if (!isNavigating) {
        draftRef.current = currentText;
      }

      if (key === 'ArrowUp') {
        const nextIndex = isNavigating
          ? Math.max(0, historyIndexRef.current - 1)
          : items.length - 1;
        historyIndexRef.current = nextIndex;
        setText(items[nextIndex] ?? draftRef.current);
        return true;
      }

      // ArrowDown
      if (!isNavigating) return true;
      if (historyIndexRef.current < items.length - 1) {
        historyIndexRef.current += 1;
        setText(items[historyIndexRef.current] ?? draftRef.current);
        return true;
      }

      historyIndexRef.current = -1;
      setText(draftRef.current);
      draftRef.current = '';
      return true;
    },
    [getTextContent, setText]
  );

  return { record, handleKeyDown };
}
