import 'package:flutter/material.dart';

import 'ui.dart';

/// Just enough Markdown for an interviewer's turn or a problem statement:
/// paragraphs, `#` headings, bullet and numbered lists, fenced code blocks,
/// and inline **bold**, *italic* and `code`. Anything else shows as text.
class SimpleMarkdown extends StatelessWidget {
  const SimpleMarkdown(this.text, {this.fontSize = 15, this.color, super.key});

  final String text;
  final double fontSize;
  final Color? color;

  @override
  Widget build(BuildContext context) {
    final tone = LearnTone.of(context);
    final base = TextStyle(
      fontSize: fontSize,
      color: color ?? tone.strong,
      height: 1.5,
    );
    final blocks = parseMarkdownBlocks(text);
    final children = <Widget>[];
    for (var i = 0; i < blocks.length; i++) {
      final block = blocks[i];
      if (i > 0) {
        children.add(
          SizedBox(
            height:
                block.kind == MdKind.listItem &&
                    blocks[i - 1].kind == MdKind.listItem
                ? 4
                : 10,
          ),
        );
      }
      switch (block.kind) {
        case MdKind.code:
          children.add(CodeBlock(block.text));
        case MdKind.heading:
          children.add(
            Text.rich(
              TextSpan(
                children: inlineMarkdown(
                  block.text,
                  base.copyWith(
                    fontWeight: FontWeight.w800,
                    fontSize: fontSize + 1,
                  ),
                ),
              ),
            ),
          );
        case MdKind.listItem:
          children.add(
            Padding(
              padding: const EdgeInsets.only(left: 4),
              child: Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  SizedBox(
                    width: 22,
                    child: Text(
                      block.marker ?? '•',
                      style: base.copyWith(color: tone.muted),
                    ),
                  ),
                  Expanded(
                    child: Text.rich(
                      TextSpan(children: inlineMarkdown(block.text, base)),
                    ),
                  ),
                ],
              ),
            ),
          );
        case MdKind.paragraph:
          children.add(
            Text.rich(TextSpan(children: inlineMarkdown(block.text, base))),
          );
      }
    }
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      mainAxisSize: MainAxisSize.min,
      children: children,
    );
  }
}

enum MdKind { paragraph, heading, listItem, code }

class MdBlock {
  const MdBlock(this.kind, this.text, {this.marker});
  final MdKind kind;
  final String text;

  /// "1." for a numbered item; null for a bullet.
  final String? marker;
}

/// Splits [source] into blocks.
List<MdBlock> parseMarkdownBlocks(String source) {
  final lines = source.replaceAll('\r\n', '\n').split('\n');
  final blocks = <MdBlock>[];
  final paragraph = <String>[];
  void flush() {
    if (paragraph.isEmpty) return;
    blocks.add(MdBlock(MdKind.paragraph, paragraph.join(' ').trim()));
    paragraph.clear();
  }

  final bullet = RegExp(r'^\s*[-*+]\s+(.*)$');
  final numbered = RegExp(r'^\s*(\d+)[.)]\s+(.*)$');
  final heading = RegExp(r'^\s*#{1,6}\s+(.*)$');
  for (var i = 0; i < lines.length; i++) {
    final line = lines[i];
    if (line.trimLeft().startsWith('```')) {
      flush();
      final code = <String>[];
      i++;
      while (i < lines.length && !lines[i].trimLeft().startsWith('```')) {
        code.add(lines[i]);
        i++;
      }
      blocks.add(MdBlock(MdKind.code, code.join('\n')));
      continue;
    }
    if (line.trim().isEmpty) {
      flush();
      continue;
    }
    final h = heading.firstMatch(line);
    if (h != null) {
      flush();
      blocks.add(MdBlock(MdKind.heading, h.group(1)!.trim()));
      continue;
    }
    final b = bullet.firstMatch(line);
    if (b != null) {
      flush();
      blocks.add(MdBlock(MdKind.listItem, b.group(1)!.trim()));
      continue;
    }
    final n = numbered.firstMatch(line);
    if (n != null) {
      flush();
      blocks.add(
        MdBlock(MdKind.listItem, n.group(2)!.trim(), marker: '${n.group(1)}.'),
      );
      continue;
    }
    paragraph.add(line.trim());
  }
  flush();
  return blocks;
}

/// **bold**, *italic* / _italic_ and `code` inside one line.
List<InlineSpan> inlineMarkdown(String text, TextStyle base) {
  final spans = <InlineSpan>[];
  final pattern = RegExp(
    r'(\*\*[^*]+\*\*|`[^`]+`|\*[^*\s][^*]*\*|_[^_\s][^_]*_)',
  );
  var at = 0;
  for (final m in pattern.allMatches(text)) {
    if (m.start > at) {
      spans.add(TextSpan(text: text.substring(at, m.start), style: base));
    }
    final token = m.group(0)!;
    if (token.startsWith('**')) {
      spans.add(
        TextSpan(
          text: token.substring(2, token.length - 2),
          style: base.copyWith(fontWeight: FontWeight.w700),
        ),
      );
    } else if (token.startsWith('`')) {
      spans.add(
        TextSpan(
          text: token.substring(1, token.length - 1),
          style: base.copyWith(
            fontFamily: 'monospace',
            fontSize: (base.fontSize ?? 14) - 1,
            backgroundColor: base.color?.withValues(alpha: 0.08),
          ),
        ),
      );
    } else {
      spans.add(
        TextSpan(
          text: token.substring(1, token.length - 1),
          style: base.copyWith(fontStyle: FontStyle.italic),
        ),
      );
    }
    at = m.end;
  }
  if (at < text.length) {
    spans.add(TextSpan(text: text.substring(at), style: base));
  }
  return spans;
}

/// Code in a monospace, horizontally scrollable box.
class CodeBlock extends StatelessWidget {
  const CodeBlock(this.code, {this.language, super.key});

  final String code;
  final String? language;

  @override
  Widget build(BuildContext context) {
    final tone = LearnTone.of(context);
    return Container(
      width: double.infinity,
      decoration: BoxDecoration(
        color: tone.raised,
        border: Border.all(color: tone.line),
        borderRadius: BorderRadius.circular(10),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          if (language != null && language!.isNotEmpty)
            Padding(
              padding: const EdgeInsets.fromLTRB(12, 8, 12, 0),
              child: Text(
                language!.toUpperCase(),
                style: TextStyle(
                  fontSize: 10,
                  letterSpacing: 0.7,
                  fontWeight: FontWeight.w700,
                  color: tone.muted,
                ),
              ),
            ),
          SingleChildScrollView(
            scrollDirection: Axis.horizontal,
            padding: const EdgeInsets.all(12),
            child: SelectableText(
              code,
              style: TextStyle(
                fontFamily: 'monospace',
                fontSize: 12.5,
                color: tone.strong,
                height: 1.45,
              ),
            ),
          ),
        ],
      ),
    );
  }
}
