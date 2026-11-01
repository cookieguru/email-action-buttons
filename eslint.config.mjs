import stylistic from '@stylistic/eslint-plugin';
import js from '@eslint/js';
import globals from 'globals';
import { defineConfig } from 'eslint/config';

export default defineConfig([
	{
		files: ['**/*.{js,mjs,cjs,ts,mts,cts}'],
		plugins: { js },
		extends: ['js/recommended'],
		languageOptions: {
			globals: {
				...globals.browser,
				messenger: 'readonly',
				EmailActionParser: 'readonly',
			},
		},
	},

	{
		files: ['**/*.js'],
		languageOptions: {
			sourceType: 'script',
		},
	},

	{
		plugins: {
			'@stylistic': stylistic,
		},
		rules: {
			'@stylistic/indent': ['error', 'tab'],
			'@stylistic/comma-dangle': ['error', 'always-multiline'],
		},
	},
]);
