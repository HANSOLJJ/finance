// finance 의 ESLint 규칙 — 권장 규칙 그대로, 브라우저 스크립트(js/)와 Node 서버(server/)의 실행 환경만 나눠 지정한다
import js from '@eslint/js';
import globals from 'globals';
import prettier from 'eslint-config-prettier';

export default [
  {
    ignores: [
      'node_modules/',
      'data/',
      'backups/',
      'ref/',
      'references/',
      'config/',
      '.playwright-mcp/',
    ],
  },

  js.configs.recommended,

  // 프론트 — index.html 이 <script> 로 순서대로 불러오는 일반 스크립트(모듈 아님).
  // 파일끼리 전역 함수를 공유하고 onclick 에서도 부르므로, 다른 파일에 정의된 이름·최상위 함수는 검사하지 않는다
  {
    files: ['js/**/*.js'],
    languageOptions: {
      sourceType: 'script',
      globals: globals.browser,
    },
    rules: {
      'no-undef': 'off',
      'no-unused-vars': ['error', { vars: 'local' }],
    },
  },

  // 서버 — Node ESM
  {
    files: ['server/**/*.js', 'eslint.config.js'],
    languageOptions: {
      sourceType: 'module',
      globals: globals.node,
    },
  },

  // pm2 설정 — CommonJS
  {
    files: ['**/*.cjs'],
    languageOptions: {
      sourceType: 'commonjs',
      globals: globals.node,
    },
  },

  // 반드시 마지막 — ESLint 의 모양 규칙을 꺼서 Prettier 와 충돌하지 않게 한다
  prettier,
];
