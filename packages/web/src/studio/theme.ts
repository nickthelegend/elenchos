// Dracula-based editor theme (as in AlgoCraft IDE), tuned to Elenchos: same token hues, the Dracula canvas.
import type { Monaco } from '@monaco-editor/react';

export function defineTheme(m: Monaco) {
  m.editor.defineTheme('elenchos', {
    base: 'vs-dark', inherit: true,
    rules: [
      { token: '', foreground: 'f8f8f2' },
      { token: 'comment', foreground: '6272a4', fontStyle: 'italic' },
      { token: 'keyword', foreground: 'ff79c6' },
      { token: 'type', foreground: '8be9fd', fontStyle: 'italic' },
      { token: 'string', foreground: 'f1fa8c' },
      { token: 'number', foreground: 'bd93f9' },
      { token: 'delimiter', foreground: 'f8f8f2' },
      { token: 'identifier', foreground: 'f8f8f2' },
      { token: 'annotation', foreground: '50fa7b' },
    ],
    colors: {
      'editor.background': '#282a36',
      'editor.foreground': '#f8f8f2',
      'editorLineNumber.foreground': '#6272a4',
      'editorLineNumber.activeForeground': '#c7cbe0',
      'editor.lineHighlightBackground': '#323544',
      'editor.selectionBackground': '#44475a',
      'editorCursor.foreground': '#f8f8f2',
      'editorIndentGuide.background1': '#2a2e42',
      'editorGutter.background': '#282a36',
      'editorWidget.background': '#21222c',
      'editorHoverWidget.background': '#21222c',
      'editorHoverWidget.border': '#44475a',
      'editorError.foreground': '#ff5555',
      'editorWarning.foreground': '#ffb86c',
      'minimap.background': '#282a36',
      'scrollbarSlider.background': '#44475a66',
      'diffEditor.insertedTextBackground': '#50fa7b22',
      'diffEditor.removedTextBackground': '#ff555522',
      'diffEditor.insertedLineBackground': '#50fa7b14',
      'diffEditor.removedLineBackground': '#ff555514',
    },
  });
}
