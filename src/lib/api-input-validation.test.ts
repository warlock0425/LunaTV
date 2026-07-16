import {
  isValidApiMediaId,
  isValidApiNumericId,
  isValidApiRemoteUrl,
  isValidApiSearchQuery,
  isValidApiSource,
  isValidApiStorageKey,
  isValidApiTextParam,
  parseAndValidateApiStorageKey,
} from './api-input-validation';

describe('api-input-validation helpers', () => {
  describe('isValidApiSource', () => {
    it('should validate typical sources', () => {
      expect(isValidApiSource('czzy')).toBe(true);
      expect(isValidApiSource('ffzy')).toBe(true);
      expect(isValidApiSource('live_source_1')).toBe(true);
    });

    it('should reject invalid sources', () => {
      expect(isValidApiSource('')).toBe(false);
      expect(isValidApiSource(null)).toBe(false);
      expect(isValidApiSource('   ')).toBe(false);
      expect(isValidApiSource('source/with/slash')).toBe(false);
      expect(isValidApiSource('source?with?query')).toBe(false);
      expect(isValidApiSource('a'.repeat(129))).toBe(false);
    });
  });

  describe('isValidApiMediaId', () => {
    it('should validate typical media ids and urls', () => {
      expect(isValidApiMediaId('12345')).toBe(true);
      expect(isValidApiMediaId('vod-id-999')).toBe(true);
      expect(isValidApiMediaId('https://example.com/live.m3u8')).toBe(true);
    });

    it('should reject invalid media ids', () => {
      expect(isValidApiMediaId('')).toBe(false);
      expect(isValidApiMediaId(undefined)).toBe(false);
      expect(isValidApiMediaId('id\nwith\nnewline')).toBe(false);
      expect(isValidApiMediaId('a'.repeat(513))).toBe(false);
    });
  });

  describe('isValidApiRemoteUrl', () => {
    it('accepts long signed HTTP URLs', () => {
      expect(
        isValidApiRemoteUrl(
          `https://example.com/live.m3u8?token=${'a'.repeat(900)}`
        )
      ).toBe(true);
    });

    it('rejects non-HTTP and oversized URLs', () => {
      expect(isValidApiRemoteUrl('file:///etc/passwd')).toBe(false);
      expect(
        isValidApiRemoteUrl(`https://example.com/${'a'.repeat(4096)}`)
      ).toBe(false);
    });
  });

  describe('isValidApiNumericId', () => {
    it('should validate positive integers', () => {
      expect(isValidApiNumericId('123')).toBe(true);
      expect(isValidApiNumericId('999999999999')).toBe(true);
    });

    it('should reject non-integers', () => {
      expect(isValidApiNumericId('12.3')).toBe(false);
      expect(isValidApiNumericId('-123')).toBe(false);
      expect(isValidApiNumericId('abc')).toBe(false);
      expect(isValidApiNumericId('1234567890123')).toBe(false); // exceeds 12 digits
    });
  });

  describe('isValidApiStorageKey', () => {
    it('should validate storage keys of form source+id', () => {
      expect(isValidApiStorageKey('czzy+12345')).toBe(true);
      expect(isValidApiStorageKey('ffzy+https://example.com/a.m3u8')).toBe(
        true
      );
    });

    it('should reject invalid storage keys', () => {
      expect(isValidApiStorageKey('invalid')).toBe(false); // no separator
      expect(isValidApiStorageKey('invalid/source+123')).toBe(false);
    });
  });

  describe('parseAndValidateApiStorageKey', () => {
    it('should parse valid keys', () => {
      const parsed = parseAndValidateApiStorageKey('czzy+12345');
      expect(parsed).toEqual({ source: 'czzy', id: '12345' });
    });

    it('should return null for invalid keys', () => {
      expect(parseAndValidateApiStorageKey('czzy?invalid+123')).toBeNull();
    });
  });

  describe('isValidApiSearchQuery', () => {
    it('should validate safe queries', () => {
      expect(isValidApiSearchQuery('石紀元')).toBe(true);
      expect(isValidApiSearchQuery('Dr. STONE')).toBe(true);
    });

    it('should reject unsafe queries', () => {
      expect(isValidApiSearchQuery('<script>')).toBe(false);
      expect(isValidApiSearchQuery('query\\with\\backslash')).toBe(false);
      expect(isValidApiSearchQuery('a'.repeat(201))).toBe(false);
    });
  });

  describe('isValidApiTextParam', () => {
    it('should validate text params within bounds', () => {
      expect(isValidApiTextParam('Normal Wording')).toBe(true);
    });

    it('should reject control characters or excessive length', () => {
      expect(isValidApiTextParam('Text with \x00 null')).toBe(false);
      expect(isValidApiTextParam('a'.repeat(201))).toBe(false);
    });
  });
});
