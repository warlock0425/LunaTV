/* eslint-disable @typescript-eslint/no-require-imports */
const OpenCC = require('opencc-js/t2cn') as {
  Converter(options: { from: 'tw'; to: 'cn' }): (text: string) => string;
};

const taiwanToMainland = OpenCC.Converter({ from: 'tw', to: 'cn' });

export function convertTaiwanToMainland(text: string): string {
  return text ? taiwanToMainland(text) : '';
}
