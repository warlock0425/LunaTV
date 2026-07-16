// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore
import stcasc from 'switch-chinese';

const converter = stcasc();

export function convertS2T(text: string): string {
  if (!text) return '';
  return converter.traditionalized(text);
}

export function convertT2S(text: string): string {
  if (!text) return '';
  return converter.simplized(text);
}
