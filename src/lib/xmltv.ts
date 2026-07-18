import he from 'he';

export interface XmlTvProgram {
  start: string;
  end: string;
  title: string;
}

export type XmlTvPrograms = Record<string, XmlTvProgram[]>;

export interface XmlTvParseBudget {
  remainingPrograms: number;
  exceeded?: boolean;
}

const PARTIAL_TAG_TAIL_LENGTH = 32;

function getAttribute(attributes: string, name: string): string {
  const match = attributes.match(
    new RegExp(`\\b${name}\\s*=\\s*(["'])(.*?)\\1`, 'i')
  );
  return match ? he.decode(match[2]) : '';
}

function decodeTitle(value: string): string {
  const withoutCdata = value.replace(/^\s*<!\[CDATA\[|\]\]>\s*$/g, '');
  return he.decode(withoutCdata.replace(/<[^>]+>/g, '').trim());
}

/**
 * 解析目前已收齊的 programme 區塊，並回傳尚未完整的尾端資料。
 * 不依賴換行，因此同時支援壓成單行與跨 chunk 的 XMLTV。
 */
export function consumeXmlTvBuffer(
  input: string,
  tvgIds: ReadonlySet<string>,
  result: XmlTvPrograms,
  flush = false,
  budget?: XmlTvParseBudget
): string {
  const programmePattern = /<programme\b([^>]*)>([\s\S]*?)<\/programme\s*>/gi;
  let match: RegExpExecArray | null;
  let lastConsumedIndex = 0;

  while ((match = programmePattern.exec(input)) !== null) {
    lastConsumedIndex = programmePattern.lastIndex;
    const attributes = match[1];
    const channel = getAttribute(attributes, 'channel');
    const start = getAttribute(attributes, 'start');
    const end = getAttribute(attributes, 'stop');

    if (!channel || !start || !end || !tvgIds.has(channel)) continue;

    const titleMatch = match[2].match(/<title\b[^>]*>([\s\S]*?)<\/title\s*>/i);
    if (!titleMatch) continue;

    const title = decodeTitle(titleMatch[1]);
    if (!title) continue;

    if (budget && budget.remainingPrograms <= 0) {
      budget.exceeded = true;
      break;
    }

    (result[channel] ||= []).push({ start, end, title });
    if (budget) budget.remainingPrograms -= 1;
  }

  if (lastConsumedIndex > 0) {
    return flush ? '' : input.slice(lastConsumedIndex);
  }

  const partialProgrammeIndex = input.lastIndexOf('<programme');
  if (partialProgrammeIndex >= 0) {
    return input.slice(partialProgrammeIndex);
  }

  return flush ? '' : input.slice(-PARTIAL_TAG_TAIL_LENGTH);
}

export function parseXmlTvText(
  xml: string,
  tvgIds: Iterable<string>
): XmlTvPrograms {
  const result: XmlTvPrograms = {};
  consumeXmlTvBuffer(xml, new Set(tvgIds), result, true);
  return result;
}
