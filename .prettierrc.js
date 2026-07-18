module.exports = {
  arrowParens: 'always',
  singleQuote: true,
  jsxSingleQuote: true,
  tabWidth: 2,
  semi: true,
  // prettier 3 預設改為 'all'，固定為 es5 以免整庫大量 reformat
  trailingComma: 'es5',
  // Windows checkout 常使用 CRLF；格式檢查不應只因作業系統換行而失敗。
  endOfLine: 'auto',
};
