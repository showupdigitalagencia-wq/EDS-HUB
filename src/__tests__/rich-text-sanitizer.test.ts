import { describe, it, expect } from 'vitest';
import {
  sanitizeRichText,
  htmlToPlainText,
  convertHtmlToBlocks,
  isSafeUrl,
} from '../utils/rich-text-sanitizer';
import { APPROVED_COURSE_TEMPLATES } from '../utils/salutation';

describe('Rich Text Sanitizer & Hydration Suite', () => {
  // ---------------------------------------------------------------------------
  // 1. Formatting Preservation
  // ---------------------------------------------------------------------------
  describe('Semantic Formatting Preservation', () => {
    it('preserves bold formatting (<strong> and <b>)', () => {
      const input = '<p><strong>Bold text</strong> and <b>also bold</b></p>';
      const clean = sanitizeRichText(input);
      expect(clean).toContain('<strong>Bold text</strong>');
      expect(clean).toContain('<strong>also bold</strong>');
    });

    it('preserves italic formatting (<em> and <i>)', () => {
      const input = '<p><em>Italic text</em> and <i>also italic</i></p>';
      const clean = sanitizeRichText(input);
      expect(clean).toContain('<em>Italic text</em>');
      expect(clean).toContain('<em>also italic</em>');
    });

    it('preserves paragraphs (<p>) and spacing', () => {
      const input = '<p>First paragraph</p><p>Second paragraph</p>';
      const clean = sanitizeRichText(input);
      expect(clean).toContain('<p>First paragraph</p>');
      expect(clean).toContain('<p>Second paragraph</p>');
    });

    it('preserves line breaks (<br>)', () => {
      const input = '<p>Line 1<br>Line 2<br/>Line 3</p>';
      const clean = sanitizeRichText(input);
      expect(clean).toContain('Line 1<br>Line 2<br>Line 3');
    });

    it('preserves bullet lists (<ul> and <li>)', () => {
      const input = '<ul><li>Hands-on training</li><li>Real patients</li><li>Individual guidance</li></ul>';
      const clean = sanitizeRichText(input);
      expect(clean).toContain('<ul>');
      expect(clean).toContain('<li>Hands-on training</li>');
      expect(clean).toContain('<li>Real patients</li>');
      expect(clean).toContain('<li>Individual guidance</li>');
      expect(clean).toContain('</ul>');
    });

    it('preserves numbered lists (<ol> and <li>)', () => {
      const input = '<ol><li>Step one</li><li>Step two</li></ol>';
      const clean = sanitizeRichText(input);
      expect(clean).toContain('<ol>');
      expect(clean).toContain('<li>Step one</li>');
      expect(clean).toContain('<li>Step two</li>');
      expect(clean).toContain('</ol>');
    });

    it('preserves underline (<u>)', () => {
      const input = '<p><u>Underlined text</u></p>';
      const clean = sanitizeRichText(input);
      expect(clean).toContain('<u>Underlined text</u>');
    });

    it('preserves valid hyperlinks (<a>) and enforces safe attributes', () => {
      const input = '<p><a href="https://expdentalsolutions.com">Visit EDS</a></p>';
      const clean = sanitizeRichText(input);
      expect(clean).toContain('<a href="https://expdentalsolutions.com" target="_blank" rel="noopener noreferrer">Visit EDS</a>');
    });

    it('normalizes Google Docs paste structure (font-weight: 700 spans to strong)', () => {
      const docsHtml = '<p><b style="font-weight:normal;" id="docs-internal-guid-123"><span style="font-weight:700;">Important Bold</span> in Docs</b></p>';
      const clean = sanitizeRichText(docsHtml);
      expect(clean).toContain('<strong>Important Bold</strong>');
      expect(clean).not.toContain('docs-internal-guid');
      expect(clean).not.toContain('style=');
    });

    it('normalizes MS Word paste structure (stripping Word comments and Mso artifacts)', () => {
      const wordHtml = '<!--[if gte mso 9]><xml><o:OfficeDocumentSettings></o:OfficeDocumentSettings></xml><![endif]--><p class="MsoNormal">Word <strong>content</strong></p>';
      const clean = sanitizeRichText(wordHtml);
      expect(clean).toContain('Word <strong>content</strong>');
      expect(clean).not.toContain('OfficeDocumentSettings');
    });
  });

  // ---------------------------------------------------------------------------
  // 2. Security & XSS Protection
  // ---------------------------------------------------------------------------
  describe('Security & XSS Protection', () => {
    it('completely removes <script> tags and contents', () => {
      const malicious = '<p>Hello</p><script>alert(1)</script><p>World</p>';
      const clean = sanitizeRichText(malicious);
      expect(clean).not.toContain('<script');
      expect(clean).not.toContain('alert(1)');
      expect(clean).toContain('Hello');
      expect(clean).toContain('World');
    });

    it('removes inline event handlers (onerror, onload, onclick, onmouseover)', () => {
      const malicious = '<img src="x" onerror="alert(1)" /><p onclick="alert(2)" onmouseover="steal()">Text</p>';
      const clean = sanitizeRichText(malicious);
      expect(clean).not.toContain('onerror');
      expect(clean).not.toContain('onclick');
      expect(clean).not.toContain('onmouseover');
      expect(clean).not.toContain('alert');
      expect(clean).toContain('Text');
    });

    it('removes javascript: and vbscript: and data: URLs in links', () => {
      const malicious = '<p><a href="javascript:alert(1)">Click here</a> <a href="vbscript:msgbox(1)">VisualBasic</a> <a href="data:text/html,<script>alert(1)</script>">Data</a></p>';
      const clean = sanitizeRichText(malicious);
      expect(clean).not.toContain('javascript:');
      expect(clean).not.toContain('vbscript:');
      expect(clean).not.toContain('data:');
      expect(clean).toContain('Click here');
    });

    it('removes <iframe>, <object>, <embed>, and dangerous containers', () => {
      const malicious = '<iframe src="https://evil.com"></iframe><object data="evil.swf"></object><embed src="evil.swf" /><p>Safe content</p>';
      const clean = sanitizeRichText(malicious);
      expect(clean).not.toContain('<iframe');
      expect(clean).not.toContain('<object');
      expect(clean).not.toContain('<embed');
      expect(clean).toContain('Safe content');
    });

    it('blocks mixed-case, whitespace, and encoded javascript protocols in href', () => {
      const vectors = [
        '<a href="JaVaScRiPt:alert(1)">Mixed Case</a>',
        '<a href="  javascript:alert(1)">Leading Spaces</a>',
        '<a href="javascript :alert(1)">Space Before Colon</a>',
        '<a href="jav&#x61;script:alert(1)">Hex Entity</a>',
        '<a href="jav&#97;script:alert(1)">Decimal Entity</a>',
        '<a href="java\0script:alert(1)">Null Byte</a>',
        '<a href="java\tscript:alert(1)">Tab In Protocol</a>',
        '<a href="//evil.com">Protocol Relative</a>',
      ];

      for (const vector of vectors) {
        const clean = sanitizeRichText(vector);
        expect(clean).not.toContain('href=');
        expect(clean).not.toContain('alert(1)');
        expect(clean).not.toContain('javascript');
      }
    });

    it('blocks SVG, MathML, and style-based script execution vectors', () => {
      const dangerousVectors = [
        '<svg><script>alert(1)</script></svg>',
        '<math><mtext><script>alert(2)</script></mtext></math>',
        '<p style="background-image: url(javascript:alert(3))">Styled</p>',
        '<p style="behavior: url(xss.htc); width: expression(alert(4));">IE Expression</p>',
      ];

      for (const vector of dangerousVectors) {
        const clean = sanitizeRichText(vector);
        expect(clean).not.toContain('<script');
        expect(clean).not.toContain('<svg');
        expect(clean).not.toContain('<math');
        expect(clean).not.toContain('alert(');
        expect(clean).not.toContain('javascript:');
      }

      // Nested/malformed script tag test
      const malformed = '<scr<script>ipt>alert(5)</script>';
      const cleanMalformed = sanitizeRichText(malformed);
      expect(cleanMalformed).not.toContain('<script');
    });

    it('validates safe vs unsafe URLs with isSafeUrl', () => {
      expect(isSafeUrl('https://expdentalsolutions.com')).toBe(true);
      expect(isSafeUrl('http://expdentalsolutions.com')).toBe(true);
      expect(isSafeUrl('mailto:info@expdentalsolutions.com')).toBe(true);
      expect(isSafeUrl('tel:+1234567890')).toBe(true);
      expect(isSafeUrl('/courses/wisdom')).toBe(true);
      expect(isSafeUrl('#section')).toBe(true);

      expect(isSafeUrl('javascript:alert(1)')).toBe(false);
      expect(isSafeUrl('JAVASCRIPT:alert(1)')).toBe(false);
      expect(isSafeUrl('JaVaScRiPt:alert(1)')).toBe(false);
      expect(isSafeUrl('  javascript:alert(1)')).toBe(false);
      expect(isSafeUrl('//evil.com/phish')).toBe(false);
      expect(isSafeUrl('data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==')).toBe(false);
      expect(isSafeUrl('vbscript:msgbox(1)')).toBe(false);
      expect(isSafeUrl('file:///etc/passwd')).toBe(false);
      expect(isSafeUrl('')).toBe(false);
      expect(isSafeUrl(null)).toBe(false);
    });
  });

  // ---------------------------------------------------------------------------
  // 3. Personalization Placeholders Preservation
  // ---------------------------------------------------------------------------
  describe('Personalization Variables Preservation', () => {
    it('preserves {{salutation}}, {{first_name}}, {{last_name}} inside formatted HTML', () => {
      const input = '<p><strong>Hello Dr. {{last_name}},</strong></p><p>Thank you {{first_name}} for your interest.</p>';
      const clean = sanitizeRichText(input);
      expect(clean).toContain('<strong>Hello Dr. {{last_name}},</strong>');
      expect(clean).toContain('Thank you {{first_name}} for your interest.');
    });

    it('preserves course and date variables', () => {
      const input = '<p>Course: <b>{{course_name}}</b> on {{course_date_range}} for {{course_tuition}}</p>';
      const clean = sanitizeRichText(input);
      expect(clean).toMatch(/<(strong|b)>\{\{course_name\}\}<\/(strong|b)>/);
      expect(clean).toContain('{{course_date_range}}');
      expect(clean).toContain('{{course_tuition}}');
    });
  });

  // ---------------------------------------------------------------------------
  // 4. Plain Text Generation
  // ---------------------------------------------------------------------------
  describe('Plain Text Conversion', () => {
    it('converts rich formatting to clean plain text', () => {
      const richHtml = '<strong>Hello Doctor</strong><br><br><ul><li>Real patients</li><li>Hands-on training</li></ul>';
      const plain = htmlToPlainText(richHtml);
      expect(plain).toContain('Hello Doctor');
      expect(plain).toContain('• Real patients');
      expect(plain).toContain('• Hands-on training');
      expect(plain).not.toContain('<strong>');
      expect(plain).not.toContain('<ul>');
      expect(plain).not.toContain('<li>');
    });
  });

  // ---------------------------------------------------------------------------
  // 5. Hydration of Existing Templates (Wisdom & others)
  // ---------------------------------------------------------------------------
  describe('Template Hydration', () => {
    it('hydrates the real Wisdom Teeth template HTML into non-empty blocks', () => {
      const wisdomPkg = APPROVED_COURSE_TEMPLATES['wisdom_course_details'];
      expect(wisdomPkg).toBeDefined();

      const sampleHtml = wisdomPkg.getHtml({ first_name: 'John', last_name: 'Smith' });
      expect(sampleHtml).toContain('Wisdom Teeth Extraction Course');

      const blocks = convertHtmlToBlocks(sampleHtml);
      expect(blocks.length).toBeGreaterThan(0);

      const textBlock = blocks.find((b) => b.type === 'text');
      expect(textBlock).toBeDefined();
      expect(textBlock?.type).toBe('text');
      // Body content is present in the block
      expect((textBlock as any).text).toContain('Wisdom Teeth Extraction Course');
      expect((textBlock as any).text).toContain('4-day intensive clinical course');
    });

    it('hydrates templates wrapped in full EDS layout table boilerplate', () => {
      const boilerplate = `
        <!DOCTYPE html>
        <html>
        <body>
          <table width="100%">
            <tr>
              <td style="padding: 32px 28px;">
                <h2>Welcome</h2>
                <p>Hello Dr. {{salutation}}</p>
                <div style="text-align: center; margin: 16px 0 20px 0;">
                  <a href="https://expdentalsolutions.com" style="background-color: #08254f; color: #ffffff;">Saiba Mais</a>
                </div>
              </td>
            </tr>
          </table>
        </body>
        </html>
      `;

      const blocks = convertHtmlToBlocks(boilerplate);
      expect(blocks.length).toBe(3);
      expect(blocks[0].type).toBe('heading');
      expect((blocks[0] as any).text).toBe('Welcome');
      expect(blocks[1].type).toBe('text');
      expect((blocks[1] as any).text).toContain('Hello Dr. {{salutation}}');
      expect(blocks[2].type).toBe('button');
      expect((blocks[2] as any).label).toBe('Saiba Mais');
      expect((blocks[2] as any).url).toBe('https://expdentalsolutions.com');
    });
  });

  // ---------------------------------------------------------------------------
  // 6. Complete Lifecycle Round-Trip
  // ---------------------------------------------------------------------------
  describe('Complete Lifecycle Round-Trip', () => {
    it('verifies untrusted paste through paste -> editor -> db -> reopen -> preview -> send HTML', () => {
      // 1. Untrusted pasted input with valid formatting, variables, AND dangerous vectors
      const untrustedPastedHtml = `
        <p><strong>Hello Dr. {{last_name}},</strong></p>
        <p>Thank you for considering our <em>{{course_name}}</em>.</p>
        <ul>
          <li>Hands-on surgery with <u>real patients</u></li>
          <li>Accredited CE credits</li>
        </ul>
        <p>Register here: <a href="https://expdentalsolutions.com/register">Official Registration</a></p>
        <script>alert('xss-1')</script>
        <img src="x" onerror="alert('xss-2')" />
        <a href="javascript:alert('xss-3')">Malicious link</a>
        <a href="JaVaScRiPt:alert('xss-4')">Mixed case protocol</a>
        <svg><script>alert('xss-5')</script></svg>
      `;

      // 2. Editor state after paste sanitization
      const editorSanitizedHtml = sanitizeRichText(untrustedPastedHtml);
      expect(editorSanitizedHtml).not.toContain('<script');
      expect(editorSanitizedHtml).not.toContain('onerror');
      expect(editorSanitizedHtml).not.toContain('javascript');
      expect(editorSanitizedHtml).not.toContain('alert');
      expect(editorSanitizedHtml).toContain('<strong>Hello Dr. {{last_name}},</strong>');
      expect(editorSanitizedHtml).toContain('<em>{{course_name}}</em>');
      expect(editorSanitizedHtml).toContain('<u>real patients</u>');
      expect(editorSanitizedHtml).toContain('<a href="https://expdentalsolutions.com/register"');

      // 3. Database representation (blocks + rendered HTML)
      const hydratedBlocks = convertHtmlToBlocks(editorSanitizedHtml);
      expect(hydratedBlocks.length).toBeGreaterThan(0);

      // 4. Save payload simulation
      const savedHtml = editorSanitizedHtml;
      const savedText = htmlToPlainText(editorSanitizedHtml);
      expect(savedText).toContain('Hello Dr. {{last_name}},');
      expect(savedText).toContain('• Hands-on surgery with real patients');

      // 5. Reopen: Hydrate blocks from saved database representation
      const reopenedBlocks = convertHtmlToBlocks(savedHtml);
      expect(reopenedBlocks.length).toBeGreaterThan(0);
      const reopenedTextBlock = reopenedBlocks.find((b) => b.type === 'text');
      expect(reopenedTextBlock).toBeDefined();

      // 6. Preview rendering: Ensures sanitized markup renders identically
      const previewHtml = savedHtml;
      expect(previewHtml).not.toContain('<script');
      expect(previewHtml).not.toContain('onerror');
      expect(previewHtml).toContain('<strong>Hello Dr. {{last_name}},</strong>');

      // 7. Automated send interpolation simulation
      const recipientPayload = {
        first_name: 'David',
        last_name: 'Silva',
        course_interest: 'Zygomatic Implant Training',
      };
      const finalSendHtml = previewHtml
        .replace(/\{\{\s*last_name\s*\}\}/g, recipientPayload.last_name)
        .replace(/\{\{\s*course_name\s*\}\}/g, recipientPayload.course_interest);

      expect(finalSendHtml).toContain('<strong>Hello Dr. Silva,</strong>');
      expect(finalSendHtml).toContain('<em>Zygomatic Implant Training</em>');
      expect(finalSendHtml).not.toContain('<script');
      expect(finalSendHtml).not.toContain('alert(');
      expect(finalSendHtml).not.toContain('onerror');
      expect(finalSendHtml).not.toContain('javascript:');
    });
  });
});
