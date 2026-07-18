import { consumeXmlTvBuffer, parseXmlTvText } from './xmltv';

describe('XMLTV parser', () => {
  it('parses minified programmes without relying on line breaks', () => {
    const xml =
      '<?xml version="1.0"?><tv><programme start="20260718080000 +0800" stop="20260718090000 +0800" channel="news"><title lang="zh">早安&amp;新聞</title></programme><programme start="20260718090000 +0800" stop="20260718100000 +0800" channel="other"><title>略過</title></programme></tv>';

    expect(parseXmlTvText(xml, ['news'])).toEqual({
      news: [
        {
          start: '20260718080000 +0800',
          end: '20260718090000 +0800',
          title: '早安&新聞',
        },
      ],
    });
  });

  it('keeps and completes a programme split across chunks', () => {
    const result: ReturnType<typeof parseXmlTvText> = {};
    const ids = new Set(['news']);
    let buffer = consumeXmlTvBuffer(
      '<tv><programme start="1" stop="2" channel="news"><tit',
      ids,
      result
    );
    buffer = consumeXmlTvBuffer(
      `${buffer}le><![CDATA[午間新聞]]></title></programme></tv>`,
      ids,
      result,
      true
    );

    expect(buffer).toBe('');
    expect(result.news).toEqual([{ start: '1', end: '2', title: '午間新聞' }]);
  });

  it('decodes XML entities in channel identifiers before matching', () => {
    const xml =
      '<programme start="1" stop="2" channel="news&amp;sports"><title>體育新聞</title></programme>';

    expect(parseXmlTvText(xml, ['news&sports'])).toEqual({
      'news&sports': [{ start: '1', end: '2', title: '體育新聞' }],
    });
  });

  it('stops collecting programmes when the parse budget is exhausted', () => {
    const result: ReturnType<typeof parseXmlTvText> = {};
    const budget = { remainingPrograms: 1 };
    const xml =
      '<programme start="1" stop="2" channel="news"><title>one</title></programme>' +
      '<programme start="2" stop="3" channel="news"><title>two</title></programme>';

    consumeXmlTvBuffer(xml, new Set(['news']), result, true, budget);

    expect(result.news).toEqual([{ start: '1', end: '2', title: 'one' }]);
    expect(budget).toEqual({ remainingPrograms: 0, exceeded: true });
  });
});
