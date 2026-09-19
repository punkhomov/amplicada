import type { editor as MonacoEditor } from 'monaco-editor';
import { useEffect, useRef, useState } from 'react';
import { useFileViewer } from './labels.js';

type MonacoModule = typeof import('monaco-editor');

let monacoPromise: Promise<MonacoModule> | null = null;

/**
 * Monaco грузится динамически и один раз на приложение: редактор нужен редко, а весит много.
 * `monaco-runtime` выставляет `MonacoEnvironment` до создания редактора — иначе не поднимутся воркеры.
 */
function loadMonaco(): Promise<MonacoModule> {
  monacoPromise ??= import('./monaco-runtime.js').then(module => module.monaco);
  return monacoPromise;
}

function prefersDark(): boolean {
  return document.documentElement.classList.contains('dark');
}

export interface TextEditorProps {
  value: string;
  language?: string;
  readOnly?: boolean;
  onChange?(value: string): void;
  onSave?(value: string): void;
  className?: string;
}

export function TextEditor({ value, language = 'plaintext', readOnly = false, onChange, onSave, className }: TextEditorProps) {
  const { labels } = useFileViewer();
  const host = useRef<HTMLDivElement | null>(null);
  const editorRef = useRef<MonacoEditor.IStandaloneCodeEditor | null>(null);
  const monacoRef = useRef<MonacoModule | null>(null);
  const initial = useRef({ value, language, readOnly });
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');

  // Свежие колбэки для подписок Monaco, которые создаются один раз.
  const callbacks = useRef({ onChange, onSave, readOnly });
  callbacks.current = { onChange, onSave, readOnly };

  useEffect(() => {
    let disposed = false;
    let changeSub: { dispose(): void } | undefined;
    let themeObserver: MutationObserver | undefined;

    loadMonaco()
      .then(monaco => {
        if (disposed || !host.current) return;
        monacoRef.current = monaco;
        const editor = monaco.editor.create(host.current, {
          value: initial.current.value,
          language: initial.current.language,
          readOnly: initial.current.readOnly,
          theme: prefersDark() ? 'vs-dark' : 'vs',
          automaticLayout: true,
          minimap: { enabled: false },
          scrollBeyondLastLine: false,
          fontSize: 12,
          tabSize: 2,
          wordWrap: 'on',
          padding: { top: 8, bottom: 8 },
          scrollbar: { alwaysConsumeMouseWheel: false, verticalScrollbarSize: 10, horizontalScrollbarSize: 10 },
        });
        editorRef.current = editor;
        changeSub = editor.onDidChangeModelContent(() => callbacks.current.onChange?.(editor.getValue()));
        editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => {
          if (!callbacks.current.readOnly) callbacks.current.onSave?.(editor.getValue());
        });
        themeObserver = new MutationObserver(() => monaco.editor.setTheme(prefersDark() ? 'vs-dark' : 'vs'));
        themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
        setStatus('ready');
      })
      .catch(() => {
        if (!disposed) setStatus('error');
      });

    return () => {
      disposed = true;
      themeObserver?.disconnect();
      changeSub?.dispose();
      editorRef.current?.dispose();
      editorRef.current = null;
    };
  }, []);

  useEffect(() => {
    const editor = editorRef.current;
    if (editor && editor.getValue() !== value) editor.setValue(value);
  }, [value]);

  useEffect(() => {
    const model = editorRef.current?.getModel();
    if (model && monacoRef.current) monacoRef.current.editor.setModelLanguage(model, language);
  }, [language]);

  useEffect(() => {
    editorRef.current?.updateOptions({ readOnly });
  }, [readOnly]);

  if (status === 'error') {
    // Monaco не поднялся — оставляем простой textarea, чтобы правка не пропала совсем.
    return (
      <textarea
        className={`h-full w-full resize-none bg-transparent p-4 font-mono text-xs outline-none ${className ?? ''}`}
        value={value}
        readOnly={readOnly}
        onChange={event => onChange?.(event.target.value)}
        onKeyDown={event => {
          if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 's') {
            event.preventDefault();
            if (!readOnly) onSave?.(value);
          }
        }}
        spellCheck={false}
        aria-label={labels.edit}
      />
    );
  }

  return (
    <div className={`relative h-full w-full ${className ?? ''}`}>
      <div ref={host} className="absolute inset-0" />
      {status === 'loading' && (
        <div className="pointer-events-none absolute inset-0 grid place-items-center text-muted-foreground text-xs">…</div>
      )}
    </div>
  );
}
