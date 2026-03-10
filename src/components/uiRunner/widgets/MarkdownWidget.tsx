// Copyright © 2026, SAS Institute Inc., Cary, NC, USA.  All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import React, { useMemo } from 'react';

interface Props {
  content: string;
}

/**
 * Lightweight markdown renderer supporting:
 * - Headings (# ## ###)
 * - Bold (**text**)
 * - Italic (*text*)
 * - Links [text](url)
 * - Images ![alt](url)
 * - Inline code `code`
 * - Line breaks (double newline = paragraph)
 */
function renderMarkdown(markdown: string): React.ReactNode[] {
  const lines = markdown.split('\n');
  const elements: React.ReactNode[] = [];
  let paragraphBuffer: string[] = [];
  let key = 0;

  const flushParagraph = () => {
    if (paragraphBuffer.length > 0) {
      const text = paragraphBuffer.join('\n');
      elements.push(<p key={key++}>{renderInline(text)}</p>);
      paragraphBuffer = [];
    }
  };

  for (const line of lines) {
    const trimmed = line.trim();

    // Empty line = flush paragraph
    if (trimmed === '') {
      flushParagraph();
      continue;
    }

    // Headings
    const headingMatch = trimmed.match(/^(#{1,3})\s+(.+)$/);
    if (headingMatch) {
      flushParagraph();
      const level = headingMatch[1].length;
      const text = headingMatch[2];
      const Tag = `h${level + 1}` as keyof JSX.IntrinsicElements; // h2, h3, h4
      elements.push(<Tag key={key++}>{renderInline(text)}</Tag>);
      continue;
    }

    // Horizontal rule
    if (/^[-*_]{3,}$/.test(trimmed)) {
      flushParagraph();
      elements.push(<hr key={key++} />);
      continue;
    }

    paragraphBuffer.push(line);
  }

  flushParagraph();
  return elements;
}

function renderInline(text: string): React.ReactNode[] {
  // Process inline elements: images, links, bold, italic, code
  const parts: React.ReactNode[] = [];
  let remaining = text;
  let key = 0;

  while (remaining.length > 0) {
    // Image: ![alt](url)
    const imgMatch = remaining.match(/^(.*?)!\[([^\]]*)\]\(([^)]+)\)/);
    if (imgMatch) {
      if (imgMatch[1]) parts.push(...renderFormattedText(imgMatch[1], key));
      key += 10;
      parts.push(
        <img
          key={key++}
          src={imgMatch[3]}
          alt={imgMatch[2]}
          className="ui-runner__markdown-img"
        />
      );
      remaining = remaining.slice(imgMatch[0].length);
      continue;
    }

    // Link: [text](url)
    const linkMatch = remaining.match(/^(.*?)\[([^\]]+)\]\(([^)]+)\)/);
    if (linkMatch) {
      if (linkMatch[1]) parts.push(...renderFormattedText(linkMatch[1], key));
      key += 10;
      parts.push(
        <a key={key++} href={linkMatch[3]} target="_blank" rel="noopener noreferrer">
          {linkMatch[2]}
        </a>
      );
      remaining = remaining.slice(linkMatch[0].length);
      continue;
    }

    // No more special inline elements — render rest as formatted text
    parts.push(...renderFormattedText(remaining, key));
    break;
  }

  return parts;
}

function renderFormattedText(text: string, startKey: number): React.ReactNode[] {
  const parts: React.ReactNode[] = [];
  let remaining = text;
  let key = startKey;

  while (remaining.length > 0) {
    // Inline code: `code`
    const codeMatch = remaining.match(/^(.*?)`([^`]+)`/);
    if (codeMatch) {
      if (codeMatch[1]) parts.push(applyEmphasis(codeMatch[1], key));
      key += 5;
      parts.push(<code key={key++} className="ui-runner__markdown-code">{codeMatch[2]}</code>);
      remaining = remaining.slice(codeMatch[0].length);
      continue;
    }

    parts.push(applyEmphasis(remaining, key));
    break;
  }

  return parts;
}

function applyEmphasis(text: string, startKey: number): React.ReactNode {
  // Bold: **text**
  const parts = text.split(/\*\*(.+?)\*\*/g);
  if (parts.length === 1) return applyItalic(text, startKey);

  return (
    <React.Fragment key={startKey}>
      {parts.map((part, i) =>
        i % 2 === 1
          ? <strong key={startKey + i}>{applyItalic(part, startKey + i * 10)}</strong>
          : applyItalic(part, startKey + i * 10)
      )}
    </React.Fragment>
  );
}

function applyItalic(text: string, startKey: number): React.ReactNode {
  const parts = text.split(/\*(.+?)\*/g);
  if (parts.length === 1) return text;

  return (
    <React.Fragment key={startKey}>
      {parts.map((part, i) =>
        i % 2 === 1 ? <em key={startKey + i}>{part}</em> : part
      )}
    </React.Fragment>
  );
}

export const MarkdownWidget: React.FC<Props> = ({ content }) => {
  const rendered = useMemo(() => renderMarkdown(content || ''), [content]);

  return (
    <div className="ui-runner__markdown">
      {rendered}
    </div>
  );
};
