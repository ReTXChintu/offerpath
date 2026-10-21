import 'dart:convert';

/// Where tapping a notification (in the Alerts tab, a system notification,
/// or a Firebase push) takes the user.
enum LinkKind { application, applications, jobs, jobSites, interviewPrep, interviewPreps, mockInterview, home }

class AppLink {
  final LinkKind kind;
  final String? id;
  const AppLink(this.kind, [this.id]);

  @override
  bool operator ==(Object other) => other is AppLink && other.kind == kind && other.id == id;

  @override
  int get hashCode => Object.hash(kind, id);

  @override
  String toString() => 'AppLink($kind${id == null ? '' : ', $id'})';
}

/// Maps a notification's `linkPage`/`linkId` (see `packages/types`
/// `Notification`) to a screen. Anything unknown opens Home.
AppLink resolveLink(String? linkPage, String? linkId) {
  final id = (linkId == null || linkId.isEmpty) ? null : linkId;
  switch (linkPage) {
    case 'application':
      return id == null ? const AppLink(LinkKind.applications) : AppLink(LinkKind.application, id);
    case 'applications':
      return const AppLink(LinkKind.applications);
    case 'jobs':
    case 'job':
      return const AppLink(LinkKind.jobs);
    case 'job-sites':
    case 'job_sites':
      return const AppLink(LinkKind.jobSites);
    // INTERVIEW_PREP_READY: `linkId` is the prep's id.
    case 'interview-prep':
    case 'interview_prep':
    case 'interview-preps':
      return id == null ? const AppLink(LinkKind.interviewPreps) : AppLink(LinkKind.interviewPrep, id);
    // MOCK_INTERVIEW_REPORT_READY: `linkId` is the mock interview's id.
    case 'mock-interview':
    case 'mock_interview':
    case 'mock-interviews':
      return id == null ? const AppLink(LinkKind.interviewPreps) : AppLink(LinkKind.mockInterview, id);
    default:
      return const AppLink(LinkKind.home);
  }
}

/// The payload stored on a local notification, read back when it's tapped.
String encodeLinkPayload(String linkPage, String? linkId) => jsonEncode({'linkPage': linkPage, 'linkId': linkId});

/// Reads [encodeLinkPayload]'s output. Older builds stored just the
/// application id, so a bare non-JSON string still opens that application.
AppLink? decodeLinkPayload(String? payload) {
  if (payload == null || payload.isEmpty) return null;
  try {
    final decoded = jsonDecode(payload);
    if (decoded is Map) return resolveLink(decoded['linkPage']?.toString(), decoded['linkId']?.toString());
  } catch (_) {
    // not JSON: the legacy application-id payload
  }
  return AppLink(LinkKind.application, payload);
}

/// A Firebase message's `data` map (string values; empty means absent).
AppLink linkFromPushData(Map<String, dynamic> data) => resolveLink(data['linkPage']?.toString(), data['linkId']?.toString());

/// Tab order in the signed-in shell (plan section 5.4).
const tabToday = 0, tabLearn = 1, tabHunt = 2, tabAlerts = 3, tabMore = 4;

/// The Hunt tab's two pages.
const huntApplications = 0, huntJobs = 1;

/// The Learn tab's pages.
const learnRoutine = 0, learnRecall = 1, learnInterviews = 2, learnPrep = 3, learnReading = 4, learnLive = 5;

/// The tab a link lands on (an application detail opens over Hunt, job
/// sites over More, an interview prep or a mock interview over Learn).
int tabFor(AppLink link) => switch (link.kind) {
      LinkKind.application || LinkKind.applications || LinkKind.jobs => tabHunt,
      LinkKind.jobSites => tabMore,
      LinkKind.interviewPrep || LinkKind.interviewPreps || LinkKind.mockInterview => tabLearn,
      LinkKind.home => tabToday,
    };
