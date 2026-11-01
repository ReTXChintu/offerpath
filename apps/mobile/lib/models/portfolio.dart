/// The user's portfolio as the phone sees it: the overview, contact-form
/// messages, and the items (projects, skills, experience, developer tools)
/// with their published state. Mirrors the private API in `docs/portfolio.md`
/// (`/api/v1/portfolio`), trimmed to what the phone shows: editing happens on
/// the website and the laptop app.
library;

import '../services/api_client.dart';
import 'json.dart';

/// Said when the user has no portfolio yet (`GET /portfolio` is a 404).
const portfolioNotSetUpMessage =
    'Set up your portfolio on the website or laptop app';

/// Why a project can't be published yet.
const portfolioNeedsImageMessage =
    'Add an image on the website or laptop app before publishing this project.';

/// The sentence for a failed portfolio call.
String portfolioErrorMessage(Object? error) {
  if (error is ApiException) return error.message;
  return "Couldn't reach the Offerpath server. Check your connection.";
}

/// The profile item a portfolio item came from (`Source` in the contract).
class PortfolioSource {
  const PortfolioSource({required this.collection, required this.id});

  /// `projects`, `experiences` or `skills`.
  final String collection;
  final String id;

  /// Null when [v] is null or isn't a usable source.
  static PortfolioSource? fromJson(dynamic v) {
    final m = asMap(v);
    if (m == null) return null;
    final collection = str(m['collection']);
    final id = str(m['id']);
    if (collection.isEmpty && id.isEmpty) return null;
    return PortfolioSource(collection: collection, id: id);
  }
}

class PortfolioCounts {
  const PortfolioCounts({
    this.projects = 0,
    this.drafts = 0,
    this.skills = 0,
    this.experience = 0,
    this.developerTools = 0,
    this.unreadMessages = 0,
  });

  factory PortfolioCounts.fromJson(Map<String, dynamic> j) => PortfolioCounts(
    projects: intOf(j['projects']),
    drafts: intOf(j['drafts']),
    skills: intOf(j['skills']),
    experience: intOf(j['experience']),
    developerTools: intOf(j['developerTools']),
    unreadMessages: intOf(j['unreadMessages']),
  );

  final int projects;
  final int drafts;
  final int skills;
  final int experience;
  final int developerTools;
  final int unreadMessages;
}

/// `PortfolioView`, the parts the phone shows.
class PortfolioOverview {
  const PortfolioOverview({
    required this.handle,
    required this.publicUrl,
    required this.counts,
    required this.cloudinaryConfigured,
    this.heroName = '',
    this.updatedAt,
  });

  factory PortfolioOverview.fromJson(Map<String, dynamic> j) =>
      PortfolioOverview(
        handle: str(j['handle']),
        publicUrl: str(j['publicUrl']),
        counts: PortfolioCounts.fromJson(mapOrEmpty(j['counts'])),
        cloudinaryConfigured: boolOf(mapOrEmpty(j['cloudinary'])['configured']),
        heroName: str(mapOrEmpty(j['settings'])['heroName']),
        updatedAt: dateOf(j['updatedAt']),
      );

  final String handle;

  /// `/api/v1/public/portfolio/<handle>/site`, a server path.
  final String publicUrl;
  final PortfolioCounts counts;
  final bool cloudinaryConfigured;
  final String heroName;
  final DateTime? updatedAt;
}

/// A message from the portfolio site's contact form.
class PortfolioMessage {
  const PortfolioMessage({
    required this.id,
    required this.name,
    required this.email,
    required this.message,
    required this.read,
    this.createdAt,
  });

  factory PortfolioMessage.fromJson(Map<String, dynamic> j) => PortfolioMessage(
    id: str(j['id']),
    name: str(j['name']),
    email: str(j['email']),
    message: str(j['message']),
    read: boolOf(j['read']),
    createdAt: dateOf(j['createdAt']),
  );

  final String id;
  final String name;
  final String email;
  final String message;
  final bool read;
  final DateTime? createdAt;

  /// The message on one line, for the inbox.
  String get preview => message.replaceAll(RegExp(r'\s+'), ' ').trim();

  PortfolioMessage copyWith({bool? read}) => PortfolioMessage(
    id: id,
    name: name,
    email: email,
    message: message,
    read: read ?? this.read,
    createdAt: createdAt,
  );
}

/// Newest first; rows without a time last.
List<PortfolioMessage> sortMessagesNewest(Iterable<PortfolioMessage> list) =>
    list.toList()
      ..sort((a, b) => (b.createdAt ?? epoch).compareTo(a.createdAt ?? epoch));

/// The four kinds of portfolio item, in the order the phone lists them.
enum PortfolioKind {
  projects('projects', 'Projects'),
  skills('skills', 'Skills'),
  experience('experience', 'Experience'),
  developerTools('developer-tools', 'Developer tools');

  const PortfolioKind(this.path, this.label);

  /// The route segment: `/portfolio/<path>`.
  final String path;
  final String label;
}

/// One portfolio item of any kind, reduced to what the publishing list
/// needs: a title, a line under it, whether it's published, and where it
/// came from.
class PortfolioItem {
  const PortfolioItem({
    required this.kind,
    required this.id,
    required this.title,
    required this.subtitle,
    required this.published,
    this.source,
    this.imageUrl,
    this.order = 0,
    this.updatedAt,
  });

  /// Reads a `ProjectItem`, `SkillGroupItem`, `ExperienceItem` or
  /// `DeveloperToolItem`.
  factory PortfolioItem.fromJson(PortfolioKind kind, Map<String, dynamic> j) {
    final String title;
    final String subtitle;
    switch (kind) {
      case PortfolioKind.projects:
        title = str(j['title']);
        subtitle = str(j['desc']);
      case PortfolioKind.skills:
        title = str(j['cat']);
        subtitle = strList(j['items']).join(', ');
      case PortfolioKind.experience:
        title = str(j['title']);
        subtitle = [
          str(j['company']),
          str(j['period']),
        ].where((s) => s.trim().isNotEmpty).join(' · ');
      case PortfolioKind.developerTools:
        title = str(j['title']);
        subtitle = str(j['shortDescription']);
    }
    return PortfolioItem(
      kind: kind,
      id: str(j['id']),
      title: title.trim().isEmpty ? 'Untitled' : title,
      subtitle: subtitle,
      published: boolOf(j['published']),
      source: PortfolioSource.fromJson(j['source']),
      imageUrl: kind == PortfolioKind.projects ? optStr(j['imageUrl']) : null,
      order: intOf(
        kind == PortfolioKind.developerTools ? j['sortOrder'] : j['order'],
      ),
      updatedAt: dateOf(j['updatedAt']),
    );
  }

  final PortfolioKind kind;
  final String id;
  final String title;
  final String subtitle;
  final bool published;

  /// The profile item it came from ("From profile"); null when added by hand.
  final PortfolioSource? source;

  /// Projects only.
  final String? imageUrl;
  final int order;
  final DateTime? updatedAt;

  bool get fromProfile => source != null;

  /// Why it can't be published, or null when it can. A project needs an
  /// image first.
  String? get publishBlockedReason =>
      kind == PortfolioKind.projects &&
          (imageUrl == null || imageUrl!.trim().isEmpty)
      ? portfolioNeedsImageMessage
      : null;

  PortfolioItem copyWith({bool? published}) => PortfolioItem(
    kind: kind,
    id: id,
    title: title,
    subtitle: subtitle,
    published: published ?? this.published,
    source: source,
    imageUrl: imageUrl,
    order: order,
    updatedAt: updatedAt,
  );
}
