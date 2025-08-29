module.exports = {
  // Line length
  printWidth: 120,

  // Indentation
  tabWidth: 2,
  useTabs: false,

  // Semicolons and quotes
  semi: true,
  singleQuote: false,
  quoteProps: "as-needed",

  // Trailing commas
  trailingComma: "es5",

  // Brackets and parentheses
  bracketSpacing: true,
  bracketSameLine: false,
  arrowParens: "avoid",

  // Other formatting
  endOfLine: "lf",
  insertPragma: false,
  requirePragma: false,
  proseWrap: "preserve",
  htmlWhitespaceSensitivity: "css",

  // File-specific overrides
  overrides: [
    {
      files: "*.json",
      options: {
        printWidth: 80,
        tabWidth: 2,
      },
    },
    {
      files: "*.md",
      options: {
        printWidth: 80,
        proseWrap: "always",
      },
    },
    {
      files: "*.yml",
      options: {
        tabWidth: 2,
        singleQuote: true,
      },
    },
  ],
};
