import type { languages } from 'monaco-editor'
import { createMatlabCompletionProvider } from './matlabCompletionProvider'

export const MATLAB_LANGUAGE_ID = 'matlab'

export const matlabLanguageConfig: languages.LanguageConfiguration = {
  comments: {
    lineComment: '%',
    blockComment: ['%{', '%}'],
  },
  brackets: [
    ['{', '}'],
    ['[', ']'],
    ['(', ')'],
  ],
  autoClosingPairs: [
    { open: '{', close: '}' },
    { open: '[', close: ']' },
    { open: '(', close: ')' },
    { open: "'", close: "'", notIn: ['string', 'comment'] },
    { open: '"', close: '"', notIn: ['string', 'comment'] },
  ],
  surroundingPairs: [
    { open: '{', close: '}' },
    { open: '[', close: ']' },
    { open: '(', close: ')' },
    { open: "'", close: "'" },
    { open: '"', close: '"' },
  ],
  folding: {
    markers: {
      start: /^\s*(function|if|for|while|switch|try|classdef)\b/,
      end: /^\s*end\b/,
    },
  },
  indentationRules: {
    increaseIndentPattern:
      /^\s*(function|if|else|elseif|for|while|switch|case|otherwise|try|catch|classdef)\b/,
    decreaseIndentPattern: /^\s*(end|else|elseif|case|otherwise|catch)\b/,
  },
}

export const matlabTokensProvider: languages.IMonarchLanguage = {
  defaultToken: '',
  tokenPostfix: '.matlab',

  keywords: [
    'if',
    'else',
    'elseif',
    'for',
    'while',
    'function',
    'end',
    'switch',
    'case',
    'otherwise',
    'try',
    'catch',
    'classdef',
    'return',
    'break',
    'continue',
    'global',
    'persistent',
    'parfor',
    'spmd',
    'methods',
    'properties',
    'events',
    'enumeration',
  ],

  builtins: [
    'disp',
    'fprintf',
    'sprintf',
    'plot',
    'zeros',
    'ones',
    'eye',
    'linspace',
    'length',
    'size',
    'sum',
    'mean',
    'max',
    'min',
    'abs',
    'sqrt',
    'sin',
    'cos',
    'tan',
    'exp',
    'log',
    'rand',
    'randn',
    'true',
    'false',
    'inf',
    'nan',
    'pi',
    'eps',
  ],

  operators: [
    '=',
    '>',
    '<',
    '~',
    '==',
    '<=',
    '>=',
    '~=',
    '&',
    '|',
    '&&',
    '||',
    '+',
    '-',
    '*',
    '/',
    '\\',
    '^',
    '.*',
    './',
    '.\\',
    '.^',
    ".'",
    ':',
    ';',
    ',',
  ],

  symbols: /[=><!~?:&|+\-*/\\^%]+/,

  tokenizer: {
    root: [
      // Block comments %{ ... %}
      [/%\{/, 'comment', '@blockComment'],
      // Line comments
      [/%.*$/, 'comment'],

      // Strings (double-quoted)
      [/"/, 'string', '@doubleString'],
      // Strings (single-quoted / char arrays)
      [/'(?=[^']|$)/, 'string', '@singleString'],

      // Numbers
      [/\d+\.?\d*([eE][+-]?\d+)?[ij]?/, 'number'],
      [/\.\d+([eE][+-]?\d+)?[ij]?/, 'number'],
      [/0[xX][0-9a-fA-F]+/, 'number.hex'],

      // Matrix brackets
      [/[[\]]/, 'delimiter.bracket'],

      // Identifiers and keywords
      [
        /[a-zA-Z_]\w*/,
        {
          cases: {
            '@keywords': 'keyword',
            '@builtins': 'type.identifier',
            '@default': 'identifier',
          },
        },
      ],

      // Operators
      [/\.['*/\\^]/, 'operator'],
      [
        /@symbols/,
        {
          cases: {
            '@operators': 'operator',
            '@default': '',
          },
        },
      ],

      // Delimiters
      [/[{}()]/, 'delimiter.bracket'],
      [/[;,]/, 'delimiter'],

      // Whitespace
      [/\s+/, 'white'],
    ],

    blockComment: [
      [/%\}/, 'comment', '@pop'],
      [/./, 'comment'],
    ],

    doubleString: [
      [/[^"]+/, 'string'],
      [/""/, 'string.escape'],
      [/"/, 'string', '@pop'],
    ],

    singleString: [
      [/[^']+/, 'string'],
      [/''/, 'string.escape'],
      [/'/, 'string', '@pop'],
    ],
  },
}

let completionProviderRegistered = false

export function registerMatlabLanguage(monaco: typeof import('monaco-editor')): void {
  if (!monaco.languages.getLanguages().some((lang) => lang.id === MATLAB_LANGUAGE_ID)) {
    monaco.languages.register({ id: MATLAB_LANGUAGE_ID, extensions: ['.m'] })
  }
  monaco.languages.setLanguageConfiguration(MATLAB_LANGUAGE_ID, matlabLanguageConfig)
  monaco.languages.setMonarchTokensProvider(MATLAB_LANGUAGE_ID, matlabTokensProvider)

  // Register completion provider once
  if (!completionProviderRegistered) {
    monaco.languages.registerCompletionItemProvider(
      MATLAB_LANGUAGE_ID,
      createMatlabCompletionProvider(monaco)
    )
    completionProviderRegistered = true
  }
}
