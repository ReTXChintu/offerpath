import 'package:flutter/material.dart';

import '../services/api_client.dart';

/// The colours the learning pages use, taken from the app theme so they
/// follow light and dark mode and Offerpath's brand.
class LearnTone {
  LearnTone.of(BuildContext context) : _scheme = Theme.of(context).colorScheme;

  final ColorScheme _scheme;

  Color get strong => _scheme.onSurface;
  Color get body => _scheme.onSurface.withValues(alpha: 0.85);
  Color get muted => _scheme.onSurfaceVariant;
  Color get line => _scheme.outlineVariant;
  Color get card => _scheme.surface;
  Color get raised => _scheme.surfaceContainerLow;
  Color get accent => _scheme.primary;
  Color get fail => _scheme.error;

  static const pass = Color(0xFF2E9E48);
  static const warn = Color(0xFFD08A0E);
}

/// The sentence to show for a failed learning call. AI answers come from
/// the user's desktop; when it's off the API answers 503 and this says so
/// plainly instead of showing an error.
String learnErrorMessage(Object? error) {
  if (error is ApiException) return error.message;
  return "Couldn't reach the Offerpath server. Check your connection.";
}

/// Whether [error] only means the desktop (and so the AI) is offline.
bool isDesktopOfflineError(Object? error) => error is ApiException && error.isDesktopOffline;

/// A small uppercase heading.
class SectionLabel extends StatelessWidget {
  const SectionLabel(this.text, {super.key});

  final String text;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 10),
      child: Text(
        text.toUpperCase(),
        style: TextStyle(fontSize: 11, letterSpacing: 0.8, fontWeight: FontWeight.w700, color: LearnTone.of(context).muted),
      ),
    );
  }
}

/// A centred message with an optional action, inside a ListView so
/// pull-to-refresh still works on an otherwise empty page.
class LearnMessage extends StatelessWidget {
  const LearnMessage({required this.title, required this.body, this.action, this.onAction, this.icon, super.key});

  final String title;
  final String body;
  final String? action;
  final VoidCallback? onAction;
  final IconData? icon;

  @override
  Widget build(BuildContext context) {
    final tone = LearnTone.of(context);
    return ListView(
      physics: const AlwaysScrollableScrollPhysics(),
      padding: const EdgeInsets.symmetric(horizontal: 32, vertical: 64),
      children: [
        if (icon != null) ...[Icon(icon, size: 40, color: tone.muted), const SizedBox(height: 12)],
        Text(title, textAlign: TextAlign.center, style: TextStyle(fontSize: 17, fontWeight: FontWeight.w700, color: tone.strong)),
        const SizedBox(height: 8),
        Text(body, textAlign: TextAlign.center, style: TextStyle(fontSize: 13, color: tone.muted, height: 1.6)),
        if (action != null && onAction != null) ...[
          const SizedBox(height: 24),
          Center(child: FilledButton(onPressed: onAction, child: Text(action!))),
        ],
      ],
    );
  }
}

/// [LearnMessage] for a failed load: the desktop-offline sentence when that's
/// all it is, else the error.
class LearnErrorView extends StatelessWidget {
  const LearnErrorView({required this.title, required this.error, required this.onRetry, super.key});

  final String title;
  final Object? error;
  final VoidCallback onRetry;

  @override
  Widget build(BuildContext context) {
    final offline = isDesktopOfflineError(error);
    return LearnMessage(
      icon: offline ? Icons.desktop_access_disabled_outlined : Icons.error_outline,
      title: offline ? 'Waiting for your desktop' : title,
      body: learnErrorMessage(error),
      action: 'Try again',
      onAction: onRetry,
    );
  }
}

/// A bordered panel.
class LearnPanel extends StatelessWidget {
  const LearnPanel({required this.child, this.padding = const EdgeInsets.all(16), super.key});

  final Widget child;
  final EdgeInsetsGeometry padding;

  @override
  Widget build(BuildContext context) {
    final tone = LearnTone.of(context);
    return Container(
      padding: padding,
      decoration: BoxDecoration(color: tone.card, border: Border.all(color: tone.line), borderRadius: BorderRadius.circular(14)),
      child: child,
    );
  }
}
