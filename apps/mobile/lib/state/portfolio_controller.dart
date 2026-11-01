import 'dart:async';

import 'package:flutter/foundation.dart';

import '../models/app_notification.dart';
import '../models/portfolio.dart';
import '../services/push_service.dart';
import 'auth_controller.dart';
import 'connection_controller.dart';

/// The notification kind the API sends for a new contact message.
const portfolioMessageKind = 'PORTFOLIO_MESSAGE';

/// More > Portfolio: the overview (handle, counts), the contact-form inbox
/// and the publishing list. Loads the overview and the inbox on sign-in (the
/// More tab shows the unread count), and the items when the publishing list
/// first opens. Reloads the inbox when a `PORTFOLIO_MESSAGE` notification
/// arrives (hub or Firebase), everything on a hub `changed` frame for the
/// portfolio or the profile it imports from, and when the connection returns.
class PortfolioController extends ChangeNotifier {
  /// `changed` collections that can change what this shows: the portfolio's
  /// own, and the synced profile that arrives as drafts.
  static const profileCollections = {
    'projects',
    'experiences',
    'candidate_profiles',
  };

  static bool isPortfolioChange(List<String> collections) => collections.any(
    (c) => c.startsWith('portfolio') || profileCollections.contains(c),
  );

  final AuthController auth;
  final ConnectionController? connection;
  final List<StreamSubscription> _subs = [];
  bool _signedIn = false;

  PortfolioController(
    this.auth, {
    this.connection,
    Stream<AppNotification>? pushes,
  }) {
    final conn = connection;
    if (conn != null) {
      _subs.add(
        conn.changed.listen((u) {
          if (_signedIn && isPortfolioChange(u.collections)) refresh();
        }),
      );
      _subs.add(
        conn.resync.listen((_) {
          if (_signedIn) refresh();
        }),
      );
      _subs.add(conn.notifications.listen(_onNotification));
    }
    _subs.add(
      (pushes ?? PushService.instance.foreground).listen(_onNotification),
    );
    auth.addListener(_onAuth);
    _onAuth();
  }

  /// Null before it loads, and when there's no portfolio ([notSetUp]).
  PortfolioOverview? overview;

  /// `GET /portfolio` said 404: the user hasn't created one yet.
  bool notSetUp = false;

  List<PortfolioMessage> messages = const [];
  Map<PortfolioKind, List<PortfolioItem>> items = const {};

  bool loading = false;
  bool loadedOnce = false;
  String? error;

  bool itemsLoading = false;
  bool itemsLoadedOnce = false;
  String? itemsError;

  /// The publishing list shows only drafts until this is turned off.
  bool draftsOnly = true;

  final Set<String> _busy = {};
  bool _again = false;

  /// Unread messages: counted from the inbox once it's loaded.
  int get unread => loadedOnce && overview != null
      ? messages.where((m) => !m.read).length
      : overview?.counts.unreadMessages ?? 0;

  /// Unpublished items: counted from the lists once they're loaded.
  int get drafts => itemsLoadedOnce
      ? items.values.expand((l) => l).where((i) => !i.published).length
      : overview?.counts.drafts ?? 0;

  PortfolioMessage? message(String id) =>
      messages.where((m) => m.id == id).firstOrNull;

  /// The items of [kind] the list shows ([draftsOnly], plus [keep]: the ones
  /// just toggled, so they don't vanish from under the user's finger).
  List<PortfolioItem> visible(
    PortfolioKind kind, {
    Set<String> keep = const {},
  }) => (items[kind] ?? const [])
      .where((i) => !draftsOnly || !i.published || keep.contains(i.id))
      .toList();

  bool isBusy(PortfolioItem item) =>
      _busy.contains('${item.kind.path}:${item.id}');

  void setDraftsOnly(bool value) {
    if (draftsOnly == value) return;
    draftsOnly = value;
    notifyListeners();
  }

  void _onAuth() {
    final signedIn = auth.status == AuthStatus.signedIn && auth.api != null;
    if (signedIn && !_signedIn) {
      _signedIn = true;
      refresh();
    } else if (!signedIn && _signedIn) {
      _signedIn = false;
      overview = null;
      notSetUp = false;
      messages = const [];
      items = const {};
      loadedOnce = false;
      itemsLoadedOnce = false;
      error = null;
      itemsError = null;
      notifyListeners();
    }
  }

  void _onNotification(AppNotification n) {
    if (_signedIn && n.kind == portfolioMessageKind) refresh();
  }

  /// The overview and the inbox (and the items, once they've been opened).
  Future<void> refresh() async {
    final api = auth.api;
    if (api == null) return;
    if (loading) {
      _again = true;
      return;
    }
    loading = true;
    notifyListeners();
    try {
      final view = await api.getPortfolio();
      overview = view;
      notSetUp = view == null;
      messages = view == null ? const [] : await api.listPortfolioMessages();
      if (view == null) items = const {};
      error = null;
    } catch (e) {
      error = portfolioErrorMessage(e);
    } finally {
      loading = false;
      loadedOnce = true;
      notifyListeners();
    }
    if (!notSetUp && itemsLoadedOnce) await loadItems();
    if (_again) {
      _again = false;
      await refresh();
    }
  }

  /// Every item of every kind.
  Future<void> loadItems() async {
    final api = auth.api;
    if (api == null || itemsLoading) return;
    itemsLoading = true;
    notifyListeners();
    try {
      final lists = await Future.wait(
        PortfolioKind.values.map(api.listPortfolioItems),
      );
      items = {
        for (var i = 0; i < PortfolioKind.values.length; i++)
          PortfolioKind.values[i]: lists[i],
      };
      itemsError = null;
    } catch (e) {
      itemsError = portfolioErrorMessage(e);
    } finally {
      itemsLoading = false;
      itemsLoadedOnce = true;
      notifyListeners();
    }
  }

  void _putMessage(PortfolioMessage m) {
    messages = [for (final x in messages) x.id == m.id ? m : x];
    notifyListeners();
  }

  /// Marks a message read or unread. Returns an error sentence, or null.
  Future<String?> setRead(String id, bool read) async {
    final api = auth.api;
    final current = message(id);
    if (api == null || current == null) return null;
    if (current.read == read) return null;
    _putMessage(current.copyWith(read: read));
    try {
      _putMessage(await api.setPortfolioMessageRead(id, read));
      return null;
    } catch (e) {
      if (message(id) != null) _putMessage(current);
      return portfolioErrorMessage(e);
    }
  }

  /// Opening a message marks it read.
  Future<String?> open(String id) => setRead(id, true);

  /// Deletes a message. Returns an error sentence, or null.
  Future<String?> deleteMessage(String id) async {
    final api = auth.api;
    if (api == null) return null;
    final before = messages;
    messages = messages.where((m) => m.id != id).toList();
    notifyListeners();
    try {
      await api.deletePortfolioMessage(id);
      return null;
    } catch (e) {
      messages = before;
      notifyListeners();
      return portfolioErrorMessage(e);
    }
  }

  void _putItem(PortfolioItem item) {
    items = {
      for (final e in items.entries)
        e.key: e.key == item.kind
            ? [for (final x in e.value) x.id == item.id ? item : x]
            : e.value,
    };
    notifyListeners();
  }

  /// Publishes or unpublishes [item]. A project with no image is refused
  /// here, without a request. Returns an error sentence, or null.
  Future<String?> setPublished(PortfolioItem item, bool published) async {
    final blocked = published ? item.publishBlockedReason : null;
    if (blocked != null) return blocked;
    final api = auth.api;
    if (api == null || isBusy(item)) return null;
    final key = '${item.kind.path}:${item.id}';
    _busy.add(key);
    _putItem(item.copyWith(published: published));
    try {
      _putItem(
        await api.setPortfolioItemPublished(item.kind, item.id, published),
      );
      return null;
    } catch (e) {
      _putItem(item);
      return portfolioErrorMessage(e);
    } finally {
      _busy.remove(key);
      notifyListeners();
    }
  }

  @override
  void dispose() {
    for (final s in _subs) {
      s.cancel();
    }
    auth.removeListener(_onAuth);
    super.dispose();
  }
}
