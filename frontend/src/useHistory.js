import { useState, useEffect, useCallback } from "react";

const KEY = "splitmysong_history";

export default function useHistory() {
  const [history, setHistory] = useState([]);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) setHistory(JSON.parse(raw));
    } catch {
      /* corrupted or empty, ignore */
    }
  }, []);

  const addEntry = useCallback((entry) => {
    setHistory((prev) => {
      const next = [{ ...entry, id: entry.id ?? crypto.randomUUID(), ts: Date.now() }, ...prev].slice(0, 20);
      localStorage.setItem(KEY, JSON.stringify(next));
      return next;
    });
  }, []);

  const removeEntry = useCallback((id) => {
    setHistory((prev) => {
      const next = prev.filter((e) => e.id !== id);
      localStorage.setItem(KEY, JSON.stringify(next));
      return next;
    });
  }, []);

  return { history, addEntry, removeEntry };
}