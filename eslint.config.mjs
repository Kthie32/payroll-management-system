import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { FlatCompat } from '@eslint/eslintrc';

const compat = new FlatCompat({ baseDirectory: dirname(fileURLToPath(import.meta.url)) });

const config = [
  {
    ignores: [
      '.next/**',
      'node_modules/**',
      'coverage/**',
      'playwright-report/**',
      'test-results/**',
      'next-env.d.ts',
    ],
  },
  ...compat.extends('next/core-web-vitals', 'next/typescript', 'prettier'),
  {
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
    },
  },
  {
    // The engine must stay pure: no I/O, DB, env or clock.
    files: ['src/lib/payroll-engine/**/*.ts'],
    ignores: ['src/lib/payroll-engine/**/__tests__/**'],
    rules: {
      'no-restricted-imports': [
        'error',
        { patterns: ['@/lib/db*', '@prisma/*', 'node:*', 'fs', 'next/*', '@/lib/audit*'] },
      ],
      'no-restricted-globals': ['error', 'process', 'fetch'],
      'no-restricted-syntax': [
        'error',
        { selector: "NewExpression[callee.name='Date'][arguments.length=0]", message: 'Engine must not read the clock.' },
        { selector: "CallExpression[callee.object.name='Date'][callee.property.name='now']", message: 'Engine must not read the clock.' },
        { selector: "CallExpression[callee.object.name='Math'][callee.property.name='random']", message: 'Engine must be deterministic.' },
      ],
    },
  },
];

export default config;
