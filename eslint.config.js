import js from "@eslint/js";
import tseslint from "typescript-eslint";

export default [
    {
        ignores: [
            "node_modules",
            "dist",
            "build",
            ".git",
            "*.config.js",
            "*.config.cjs"
        ]
    },
    js.configs.recommended,
    ...tseslint.configs.recommended,
    {
        languageOptions: {
            ecmaVersion: 2024,
            sourceType: "module",
            parser: tseslint.parser
        },
        rules: {
            "linebreak-style": 1,
            "indent": ["error", 4],
            "quotes": ["error", "double"],
            "no-unused-vars": "off",
            "@typescript-eslint/no-unused-vars": [
                "error",
                {
                    argsIgnorePattern: "^_",
                    varsIgnorePattern: "^_"
                }
            ],
            "@typescript-eslint/no-explicit-any": "warn"
        }
    }
];
