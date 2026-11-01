import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../models/portfolio.dart';
import '../state/portfolio_controller.dart';
import '../widgets/common.dart';
import '../widgets/empty_state.dart';
import 'portfolio_messages_screen.dart';

/// More > Portfolio: the overview (handle and counts) and the two things
/// the phone does with a portfolio: read contact messages, and publish
/// drafts. Editing lives on the website and the laptop app.
class PortfolioScreen extends StatefulWidget {
  const PortfolioScreen({super.key});

  @override
  State<PortfolioScreen> createState() => _PortfolioScreenState();
}

class _PortfolioScreenState extends State<PortfolioScreen> {
  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (!mounted) return;
      final c = context.read<PortfolioController>();
      if (!c.loading) c.refresh();
    });
  }

  @override
  Widget build(BuildContext context) {
    final c = context.watch<PortfolioController>();
    final overview = c.overview;

    final List<Widget> children;
    if (overview == null && (c.loading || !c.loadedOnce)) {
      children = [
        const SizedBox(
          height: 380,
          child: Center(child: CircularProgressIndicator()),
        ),
      ];
    } else if (c.notSetUp) {
      children = [
        const SizedBox(
          height: 380,
          child: EmptyState(
            icon: Icons.web_outlined,
            title: portfolioNotSetUpMessage,
            message: 'Create it there once and pick a handle. Then contact messages and drafts from your profile show up here.',
          ),
        ),
      ];
    } else if (overview == null) {
      children = [
        SizedBox(
          height: 380,
          child: EmptyState(
            icon: Icons.error_outline,
            title: 'Could not load your portfolio',
            message: c.error,
            action: OutlinedButton(
              onPressed: c.refresh,
              child: const Text('Try again'),
            ),
          ),
        ),
      ];
    } else {
      children = _overview(context, c, overview);
    }

    return Scaffold(
      appBar: AppBar(title: const Text('Portfolio')),
      body: RefreshIndicator(
        onRefresh: c.refresh,
        child: ListView(
          physics: const AlwaysScrollableScrollPhysics(),
          padding: const EdgeInsets.fromLTRB(16, 4, 16, 24),
          children: children,
        ),
      ),
    );
  }

  List<Widget> _overview(
    BuildContext context,
    PortfolioController c,
    PortfolioOverview o,
  ) {
    final theme = Theme.of(context);
    final scheme = theme.colorScheme;
    final counts = o.counts;
    final unread = c.unread;
    final drafts = c.drafts;

    Widget stat(
      String label,
      int count,
      IconData icon,
      Color color, {
      VoidCallback? onTap,
    }) => StatTile(
      label: label,
      count: count,
      icon: icon,
      color: color,
      onTap: onTap,
    );

    return [
      AppCard(
        child: Row(
          children: [
            IconBubble(Icons.web, color: scheme.primary, size: 44),
            const SizedBox(width: 14),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    '@${o.handle}',
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: theme.textTheme.titleMedium?.copyWith(
                      fontWeight: FontWeight.w800,
                    ),
                  ),
                  if (o.heroName.isNotEmpty)
                    Text(
                      o.heroName,
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: theme.textTheme.bodySmall?.copyWith(
                        color: scheme.onSurfaceVariant,
                      ),
                    ),
                  Text(
                    'Edit it on the website or laptop app.',
                    style: theme.textTheme.bodySmall?.copyWith(
                      color: scheme.onSurfaceVariant,
                    ),
                  ),
                ],
              ),
            ),
          ],
        ),
      ),
      if (c.error != null)
        Padding(
          padding: const EdgeInsets.only(top: 8),
          child: Text(c.error!, style: TextStyle(color: scheme.error)),
        ),
      const SizedBox(height: 8),
      LayoutBuilder(
        builder: (context, box) {
          final columns = box.maxWidth >= 600 ? 6 : 3;
          return GridView.count(
            crossAxisCount: columns,
            shrinkWrap: true,
            physics: const NeverScrollableScrollPhysics(),
            mainAxisSpacing: 4,
            crossAxisSpacing: 4,
            childAspectRatio: 0.95,
            children: [
              stat(
                'Unread messages',
                unread,
                Icons.mark_email_unread_outlined,
                Colors.deepOrange,
                onTap: () => openPortfolioMessages(context),
              ),
              stat(
                'Drafts',
                drafts,
                Icons.edit_note,
                Colors.amber.shade800,
                onTap: () => openPortfolioPublishing(context),
              ),
              stat(
                'Projects',
                counts.projects,
                Icons.folder_open,
                scheme.primary,
              ),
              stat('Skills', counts.skills, Icons.bolt, Colors.teal),
              stat(
                'Experience',
                counts.experience,
                Icons.work_outline,
                Colors.indigo,
              ),
              stat(
                'Developer tools',
                counts.developerTools,
                Icons.build_outlined,
                Colors.blueGrey,
              ),
            ],
          );
        },
      ),
      const SectionHeader('On your phone'),
      AppCard(
        padding: const EdgeInsets.symmetric(vertical: 4),
        child: Column(
          children: [
            ListTile(
              leading: IconBubble(
                Icons.mail_outline,
                color: Colors.deepOrange,
                size: 38,
              ),
              title: const Text(
                'Messages',
                style: TextStyle(fontWeight: FontWeight.w600),
              ),
              subtitle: Text(
                unread > 0
                    ? '$unread unread from your contact form'
                    : 'What visitors sent through your contact form',
              ),
              trailing: unread > 0
                  ? Badge(label: Text('$unread'))
                  : const Icon(Icons.chevron_right),
              onTap: () => openPortfolioMessages(context),
            ),
            const Divider(indent: 70),
            ListTile(
              leading: IconBubble(
                Icons.publish_outlined,
                color: Colors.green,
                size: 38,
              ),
              title: const Text(
                'Drafts & publishing',
                style: TextStyle(fontWeight: FontWeight.w600),
              ),
              subtitle: Text(
                drafts > 0
                    ? '$drafts draft${drafts == 1 ? '' : 's'} waiting to be published'
                    : 'Choose what your site shows',
              ),
              trailing: const Icon(Icons.chevron_right),
              onTap: () => openPortfolioPublishing(context),
            ),
          ],
        ),
      ),
    ];
  }
}

Future<void> openPortfolioPublishing(BuildContext context) => Navigator.of(
  context,
).push(MaterialPageRoute<void>(builder: (_) => const PortfolioPublishScreen()));

/// Portfolio > Drafts & publishing: every item, grouped by kind, with a
/// Published switch. Shows drafts only until that filter is turned off. A
/// project can't be published until it has an image, which is added on the
/// website or laptop app.
class PortfolioPublishScreen extends StatefulWidget {
  const PortfolioPublishScreen({super.key});

  @override
  State<PortfolioPublishScreen> createState() => _PortfolioPublishScreenState();
}

class _PortfolioPublishScreenState extends State<PortfolioPublishScreen> {
  /// Items toggled on this visit: kept in the list even once published, so
  /// a mistaken tap can be undone.
  final Set<String> _touched = {};

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (!mounted) return;
      context.read<PortfolioController>().loadItems();
    });
  }

  Future<void> _refresh(PortfolioController c) async {
    setState(_touched.clear);
    await c.loadItems();
  }

  Future<void> _toggle(
    PortfolioController c,
    PortfolioItem item,
    bool published,
  ) async {
    setState(() => _touched.add(item.id));
    final err = await c.setPublished(item, published);
    if (err != null && mounted) {
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(err)));
    }
  }

  @override
  Widget build(BuildContext context) {
    final c = context.watch<PortfolioController>();
    final sections = [
      for (final kind in PortfolioKind.values)
        (kind, c.visible(kind, keep: _touched)),
    ].where((s) => s.$2.isNotEmpty).toList();

    Widget content;
    if (!c.itemsLoadedOnce && c.itemsLoading) {
      content = const SizedBox(
        height: 320,
        child: Center(child: CircularProgressIndicator()),
      );
    } else if (c.notSetUp) {
      content = const SizedBox(
        height: 320,
        child: EmptyState(
          icon: Icons.web_outlined,
          title: portfolioNotSetUpMessage,
        ),
      );
    } else if (sections.isEmpty) {
      content = SizedBox(
        height: 320,
        child: EmptyState(
          icon: c.itemsError != null
              ? Icons.error_outline
              : Icons.check_circle_outline,
          title: c.itemsError != null
              ? 'Could not load your portfolio'
              : (c.draftsOnly ? 'No drafts' : 'Nothing in your portfolio yet'),
          message:
              c.itemsError ??
              (c.draftsOnly
                  ? 'Everything is published. New items from your profile arrive here as drafts.'
                  : 'Add projects, skills and experience on the website or laptop app.'),
        ),
      );
    } else {
      content = Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          if (c.itemsError != null)
            Padding(
              padding: const EdgeInsets.only(top: 8),
              child: Text(
                c.itemsError!,
                style: TextStyle(color: Theme.of(context).colorScheme.error),
              ),
            ),
          for (final (kind, list) in sections) ...[
            SectionHeader(
              kind.label,
              subtitle:
                  '${list.where((i) => !i.published).length} draft${list.where((i) => !i.published).length == 1 ? '' : 's'}',
            ),
            AppCard(
              padding: const EdgeInsets.symmetric(vertical: 4),
              child: Column(
                children: [
                  for (var i = 0; i < list.length; i++) ...[
                    if (i > 0) const Divider(height: 1, indent: 16),
                    _ItemRow(
                      item: list[i],
                      busy: c.isBusy(list[i]),
                      onChanged: (v) => _toggle(c, list[i], v),
                    ),
                  ],
                ],
              ),
            ),
          ],
        ],
      );
    }

    return Scaffold(
      appBar: AppBar(title: const Text('Drafts & publishing')),
      body: RefreshIndicator(
        onRefresh: () => _refresh(c),
        child: ListView(
          physics: const AlwaysScrollableScrollPhysics(),
          padding: const EdgeInsets.fromLTRB(16, 4, 16, 24),
          children: [
            Padding(
              padding: const EdgeInsets.only(top: 8),
              child: Wrap(
                spacing: 8,
                children: [
                  FilterChip(
                    label: const Text('Drafts only'),
                    selected: c.draftsOnly,
                    onSelected: c.setDraftsOnly,
                  ),
                ],
              ),
            ),
            content,
          ],
        ),
      ),
    );
  }
}

class _ItemRow extends StatelessWidget {
  const _ItemRow({
    required this.item,
    required this.busy,
    required this.onChanged,
  });

  final PortfolioItem item;
  final bool busy;
  final ValueChanged<bool> onChanged;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final scheme = theme.colorScheme;
    final blocked = !item.published ? item.publishBlockedReason : null;
    return Padding(
      padding: const EdgeInsets.fromLTRB(16, 10, 8, 10),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  item.title,
                  maxLines: 2,
                  overflow: TextOverflow.ellipsis,
                  style: theme.textTheme.titleSmall?.copyWith(
                    fontWeight: FontWeight.w700,
                  ),
                ),
                if (item.subtitle.isNotEmpty) ...[
                  const SizedBox(height: 2),
                  Text(
                    item.subtitle,
                    maxLines: 2,
                    overflow: TextOverflow.ellipsis,
                    style: theme.textTheme.bodySmall?.copyWith(
                      color: scheme.onSurfaceVariant,
                    ),
                  ),
                ],
                const SizedBox(height: 6),
                Wrap(
                  spacing: 6,
                  runSpacing: 4,
                  children: [
                    item.published
                        ? const Tag('Published', color: Colors.green)
                        : Tag('Draft', color: Colors.amber.shade800),
                    if (item.fromProfile)
                      Tag(
                        'From profile',
                        color: scheme.primary,
                        icon: Icons.person_outline,
                      ),
                  ],
                ),
                if (blocked != null) ...[
                  const SizedBox(height: 6),
                  Row(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Icon(
                        Icons.image_not_supported_outlined,
                        size: 14,
                        color: Colors.orange.shade800,
                      ),
                      const SizedBox(width: 4),
                      Expanded(
                        child: Text(
                          blocked,
                          style: TextStyle(
                            fontSize: 12,
                            color: Colors.orange.shade800,
                          ),
                        ),
                      ),
                    ],
                  ),
                ],
              ],
            ),
          ),
          Semantics(
            label: 'Published',
            child: Switch(
              key: ValueKey('publish-${item.kind.path}-${item.id}'),
              value: item.published,
              // Still tappable when blocked: the tap says why.
              onChanged: busy ? null : onChanged,
            ),
          ),
        ],
      ),
    );
  }
}
