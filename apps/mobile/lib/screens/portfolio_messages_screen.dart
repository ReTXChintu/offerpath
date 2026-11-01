import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import 'package:url_launcher/url_launcher.dart';

import '../models/portfolio.dart';
import '../state/portfolio_controller.dart';
import '../util/format.dart';
import '../widgets/common.dart';
import '../widgets/empty_state.dart';

/// Opens a mail app (`mailto:`); replaced in tests.
typedef MailLauncher = Future<bool> Function(Uri uri);

Future<bool> _launchMail(Uri uri) => launchUrl(uri);

/// A `mailto:` address replying to [m].
Uri replyMailUri(PortfolioMessage m) => Uri(
  scheme: 'mailto',
  path: m.email,
  // Not queryParameters: that encodes spaces as '+', which some mail
  // apps show as is.
  query: 'subject=${Uri.encodeComponent('Re: your message on my portfolio')}',
);

Future<void> openPortfolioMessages(BuildContext context) =>
    Navigator.of(context).push(
      MaterialPageRoute<void>(builder: (_) => const PortfolioMessagesScreen()),
    );

Future<void> openPortfolioMessage(BuildContext context, String id) =>
    Navigator.of(context).push(
      MaterialPageRoute<void>(
        builder: (_) => PortfolioMessagePage(messageId: id),
      ),
    );

void _snack(BuildContext context, String text) =>
    ScaffoldMessenger.maybeOf(context)
        ?.showSnackBar(SnackBar(content: Text(text)));

Future<bool> _confirmDelete(
  BuildContext context,
  PortfolioMessage m,
) => confirmDialog(
  context,
  title: 'Delete this message?',
  message:
      'The message from ${m.name.isEmpty ? m.email : m.name} is deleted for good.',
  confirm: 'Delete',
);

/// Portfolio > Messages: what visitors sent through the site's contact form,
/// newest first. Open one to read it (that marks it read); each row can be
/// marked read or unread, or deleted.
class PortfolioMessagesScreen extends StatefulWidget {
  const PortfolioMessagesScreen({super.key});

  @override
  State<PortfolioMessagesScreen> createState() =>
      _PortfolioMessagesScreenState();
}

class _PortfolioMessagesScreenState extends State<PortfolioMessagesScreen> {
  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (!mounted) return;
      final c = context.read<PortfolioController>();
      if (!c.loadedOnce) c.refresh();
    });
  }

  Future<void> _delete(PortfolioController c, PortfolioMessage m) async {
    if (!await _confirmDelete(context, m)) return;
    final err = await c.deleteMessage(m.id);
    if (!mounted) return;
    _snack(context, err ?? 'Message deleted.');
  }

  Future<void> _setRead(
    PortfolioController c,
    PortfolioMessage m,
    bool read,
  ) async {
    final err = await c.setRead(m.id, read);
    if (err != null && mounted) _snack(context, err);
  }

  @override
  Widget build(BuildContext context) {
    final c = context.watch<PortfolioController>();
    final unread = c.unread;

    Widget body;
    if (!c.loadedOnce && c.loading) {
      body = const Center(child: CircularProgressIndicator());
    } else if (c.notSetUp) {
      body = _scrollable(
        const EmptyState(
          icon: Icons.web_outlined,
          title: portfolioNotSetUpMessage,
          message: 'Messages from your portfolio site\'s contact form show up here once it\'s running.',
        ),
      );
    } else if (c.messages.isEmpty) {
      body = _scrollable(
        EmptyState(
          icon: c.error != null ? Icons.error_outline : Icons.mail_outline,
          title: c.error != null
              ? 'Could not load messages'
              : 'No messages yet',
          message: c.error ?? 'When someone writes through your portfolio\'s contact form, it shows up here and your phone is notified.',
        ),
      );
    } else {
      body = ListView(
        physics: const AlwaysScrollableScrollPhysics(),
        padding: const EdgeInsets.fromLTRB(16, 8, 16, 24),
        children: [
          for (final m in c.messages)
            Padding(
              padding: const EdgeInsets.only(bottom: 8),
              child: _MessageTile(
                m: m,
                onTap: () => openPortfolioMessage(context, m.id),
                onSetRead: (read) => _setRead(c, m, read),
                onDelete: () => _delete(c, m),
              ),
            ),
        ],
      );
    }

    return Scaffold(
      appBar: AppBar(
        title: Text(unread > 0 ? 'Messages ($unread)' : 'Messages'),
      ),
      body: RefreshIndicator(onRefresh: c.refresh, child: body),
    );
  }

  Widget _scrollable(Widget child) => ListView(
    physics: const AlwaysScrollableScrollPhysics(),
    children: [SizedBox(height: 380, child: child)],
  );
}

class _MessageTile extends StatelessWidget {
  const _MessageTile({
    required this.m,
    required this.onTap,
    required this.onSetRead,
    required this.onDelete,
  });

  final PortfolioMessage m;
  final VoidCallback onTap;
  final ValueChanged<bool> onSetRead;
  final VoidCallback onDelete;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final scheme = theme.colorScheme;
    final unread = !m.read;
    final name = m.name.isEmpty ? m.email : m.name;
    return AppCard(
      onTap: onTap,
      color: unread ? null : scheme.surfaceContainerLow,
      padding: const EdgeInsets.fromLTRB(14, 12, 4, 12),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          CircleAvatar(
            radius: 18,
            backgroundColor: scheme.primary.withValues(alpha: 0.14),
            child: Text(
              name.isEmpty ? '?' : name.characters.first.toUpperCase(),
              style: TextStyle(
                color: scheme.primary,
                fontWeight: FontWeight.w700,
              ),
            ),
          ),
          const SizedBox(width: 12),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  children: [
                    Expanded(
                      child: Text(
                        name,
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: theme.textTheme.titleSmall?.copyWith(
                          fontWeight: unread
                              ? FontWeight.w800
                              : FontWeight.w600,
                        ),
                      ),
                    ),
                    if (unread)
                      Container(
                        key: const ValueKey('unread-dot'),
                        width: 8,
                        height: 8,
                        margin: const EdgeInsets.only(left: 8),
                        decoration: BoxDecoration(
                          color: scheme.primary,
                          shape: BoxShape.circle,
                        ),
                      ),
                  ],
                ),
                if (m.name.isNotEmpty && m.email.isNotEmpty)
                  Text(
                    m.email,
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: theme.textTheme.bodySmall?.copyWith(
                      color: scheme.onSurfaceVariant,
                    ),
                  ),
                const SizedBox(height: 4),
                Text(
                  m.preview,
                  maxLines: 2,
                  overflow: TextOverflow.ellipsis,
                  style: theme.textTheme.bodySmall?.copyWith(
                    color: scheme.onSurface.withValues(alpha: 0.85),
                    fontWeight: unread ? FontWeight.w600 : null,
                  ),
                ),
                if (m.createdAt != null) ...[
                  const SizedBox(height: 6),
                  Text(
                    timeAgo(m.createdAt),
                    style: theme.textTheme.bodySmall?.copyWith(
                      color: scheme.onSurfaceVariant,
                      fontSize: 11.5,
                    ),
                  ),
                ],
              ],
            ),
          ),
          PopupMenuButton<String>(
            tooltip: 'Message actions',
            onSelected: (v) =>
                v == 'delete' ? onDelete() : onSetRead(v == 'read'),
            itemBuilder: (_) => [
              unread
                  ? const PopupMenuItem(
                      value: 'read',
                      child: Text('Mark as read'),
                    )
                  : const PopupMenuItem(
                      value: 'unread',
                      child: Text('Mark as unread'),
                    ),
              const PopupMenuItem(value: 'delete', child: Text('Delete')),
            ],
          ),
        ],
      ),
    );
  }
}

/// One message in full. Opening it marks it read; it can be marked unread
/// again, deleted, or answered by email.
class PortfolioMessagePage extends StatefulWidget {
  const PortfolioMessagePage({
    required this.messageId,
    this.launchMail,
    super.key,
  });

  final String messageId;

  /// Opens the mail app; [launchUrl] by default.
  final MailLauncher? launchMail;

  @override
  State<PortfolioMessagePage> createState() => _PortfolioMessagePageState();
}

class _PortfolioMessagePageState extends State<PortfolioMessagePage> {
  bool _marked = false;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) => _markRead());
  }

  /// Marks it read once it's here, loading the inbox first when the page
  /// was opened from a notification before the inbox loaded.
  Future<void> _markRead() async {
    if (!mounted || _marked) return;
    final c = context.read<PortfolioController>();
    if (c.message(widget.messageId) == null) await c.refresh();
    if (!mounted || c.message(widget.messageId) == null) return;
    _marked = true;
    final err = await c.open(widget.messageId);
    if (err != null && mounted) _snack(context, err);
  }

  Future<void> _markUnread(PortfolioController c) async {
    final err = await c.setRead(widget.messageId, false);
    if (!mounted) return;
    if (err != null) {
      _snack(context, err);
      return;
    }
    _snack(context, 'Marked as unread.');
    Navigator.of(context).pop();
  }

  Future<void> _delete(PortfolioController c, PortfolioMessage m) async {
    if (!await _confirmDelete(context, m)) return;
    final err = await c.deleteMessage(m.id);
    if (!mounted) return;
    _snack(context, err ?? 'Message deleted.');
    if (err == null) Navigator.of(context).pop();
  }

  Future<void> _reply(PortfolioMessage m) async {
    final ok = await (widget.launchMail ?? _launchMail)(replyMailUri(m));
    if (!ok && mounted) {
      _snack(context, 'No mail app to open. Write to ${m.email}.');
    }
  }

  @override
  Widget build(BuildContext context) {
    final c = context.watch<PortfolioController>();
    final m = c.message(widget.messageId);
    final theme = Theme.of(context);
    final scheme = theme.colorScheme;

    if (m == null) {
      return Scaffold(
        appBar: AppBar(title: const Text('Message')),
        body: c.loading || !c.loadedOnce
            ? const Center(child: CircularProgressIndicator())
            : EmptyState(
                icon: Icons.mail_outline,
                title: c.notSetUp
                    ? portfolioNotSetUpMessage
                    : 'This message isn\'t here any more',
                message:
                    c.error ??
                    (c.notSetUp ? null : 'It may have been deleted.'),
              ),
      );
    }

    return Scaffold(
      appBar: AppBar(
        title: const Text('Message'),
        actions: [
          if (m.read)
            IconButton(
              tooltip: 'Mark as unread',
              icon: const Icon(Icons.mark_email_unread_outlined),
              onPressed: () => _markUnread(c),
            ),
          IconButton(
            tooltip: 'Delete',
            icon: const Icon(Icons.delete_outline),
            onPressed: () => _delete(c, m),
          ),
        ],
      ),
      body: ListView(
        padding: const EdgeInsets.fromLTRB(16, 8, 16, 32),
        children: [
          AppCard(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  m.name.isEmpty ? 'No name' : m.name,
                  style: theme.textTheme.titleLarge?.copyWith(
                    fontWeight: FontWeight.w800,
                  ),
                ),
                const SizedBox(height: 4),
                if (m.email.isNotEmpty)
                  InkWell(
                    onTap: () => _reply(m),
                    child: Padding(
                      padding: const EdgeInsets.symmetric(vertical: 4),
                      child: Row(
                        children: [
                          Icon(
                            Icons.mail_outline,
                            size: 16,
                            color: scheme.primary,
                          ),
                          const SizedBox(width: 6),
                          Flexible(
                            child: Text(
                              m.email,
                              style: TextStyle(
                                color: scheme.primary,
                                fontWeight: FontWeight.w600,
                                decoration: TextDecoration.underline,
                                decorationColor: scheme.primary,
                              ),
                            ),
                          ),
                        ],
                      ),
                    ),
                  ),
                if (m.createdAt != null)
                  Text(
                    '${timeAgo(m.createdAt)} · ${formatDateTime(context, m.createdAt)}',
                    style: theme.textTheme.bodySmall?.copyWith(
                      color: scheme.onSurfaceVariant,
                    ),
                  ),
                const Divider(height: 28),
                SelectableText(
                  m.message,
                  style: theme.textTheme.bodyLarge?.copyWith(height: 1.5),
                ),
              ],
            ),
          ),
          if (m.email.isNotEmpty) ...[
            const SizedBox(height: 16),
            FilledButton.icon(
              onPressed: () => _reply(m),
              icon: const Icon(Icons.reply),
              label: const Text('Reply by email'),
            ),
          ],
        ],
      ),
    );
  }
}
