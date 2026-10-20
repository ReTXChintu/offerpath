import 'dart:async';

import 'package:flutter/foundation.dart';

import '../models/interview_prep.dart';
import '../models/mock_interview.dart';
import '../services/api_client.dart';

/// What the candidate is sending: shown in the transcript at once, before
/// the interviewer's reply comes back.
class PendingAnswer {
  const PendingAnswer({required this.text, this.code, this.codeLanguage});
  final String text;
  final String? code;
  final String? codeLanguage;
}

/// One mock interview on screen: the transcript, sending answers (which can
/// take up to a minute while the interviewer thinks), retrying a failed
/// reply, ending it, and the report. While the server is working (the
/// interviewer replying, or the report being written) it checks again every
/// [pollEvery], and at once on the hub's `changed` frame for
/// `interview_preps` ([changes], from `InterviewPrepController.changes`).
class MockInterviewController extends ChangeNotifier {
  MockInterviewController({
    required this.api,
    required String interviewId,
    MockInterview? initial,
    Stream<void>? changes,
    this.pollEvery = const Duration(seconds: 4),
  }) : _id = initial?.id ?? interviewId,
       interview = initial {
    _changesSub = changes?.listen((_) {
      final current = interview;
      if (current == null || !current.isCompleted) load();
    });
  }

  final ApiClient api;
  final Duration pollEvery;
  String _id;
  StreamSubscription<void>? _changesSub;
  Timer? _poll;
  bool _loading = false;
  bool _disposed = false;

  MockInterview? interview;

  /// Why the first load failed (nothing to show yet).
  Object? loadError;

  /// An answer on its way: the interviewer is thinking.
  PendingAnswer? pending;

  /// A finish, reply, report retry or restart is running.
  bool busy = false;

  /// The last failed action, as a sentence.
  String? actionError;

  String get interviewId => _id;
  bool get sending => pending != null;

  /// The interviewer is working on a reply (this phone is waiting for it, or
  /// the server says it's on it).
  bool get thinking =>
      sending ||
      (interview?.isInProgress == true && interview!.replying) ||
      (busy && interview?.replyFailed == true);

  void _notify() {
    if (!_disposed) notifyListeners();
  }

  void _show(MockInterview next) {
    interview = next;
    _id = next.id;
    loadError = null;
    _schedulePoll();
  }

  Future<void> load() async {
    if (_loading || _disposed) return;
    _loading = true;
    try {
      _show(await api.getMockInterview(_id));
    } catch (error) {
      if (interview == null) loadError = error;
      _schedulePoll();
    } finally {
      _loading = false;
      _notify();
    }
  }

  void _schedulePoll() {
    _poll?.cancel();
    final current = interview;
    if (_disposed || current == null || !current.needsPolling) return;
    _poll = Timer(pollEvery, load);
  }

  /// Sends an answer. Returns whether it was saved: false means the
  /// composer should keep what was typed.
  Future<bool> answer({
    required String text,
    String? code,
    String? codeLanguage,
  }) async {
    final current = interview;
    if (current == null || sending || !current.canAnswer) return false;
    final hasCode = code != null && code.trim().isNotEmpty;
    if (text.trim().isEmpty && !hasCode) {
      actionError = current.isCodingQuestion
          ? 'Write your answer or your code first.'
          : 'Write or say your answer first.';
      _notify();
      return false;
    }
    if (text.trim().length > 8000) {
      actionError = 'Keep the answer under 8,000 characters.';
      _notify();
      return false;
    }
    if (hasCode && code.length > 20000) {
      actionError = 'Keep the code under 20,000 characters.';
      _notify();
      return false;
    }
    final before = current.answered;
    pending = PendingAnswer(
      text: text.trim(),
      code: hasCode ? code : null,
      codeLanguage: hasCode ? codeLanguage : null,
    );
    actionError = null;
    _poll?.cancel();
    _notify();
    try {
      _show(
        await api.answerMockInterview(
          current.id,
          text: text,
          code: hasCode ? code : null,
          codeLanguage: hasCode ? codeLanguage : null,
        ),
      );
      return true;
    } catch (error) {
      actionError = prepErrorMessage(error);
      // A 503 saves the answer (`awaitingReply`); a timeout may have too.
      // Ask the server rather than guess, so nothing is sent twice or lost.
      try {
        final fresh = await api.getMockInterview(current.id);
        _show(fresh);
        // Still working on it (this phone gave up waiting): just wait.
        if (fresh.replying) actionError = null;
        return fresh.answered > before;
      } catch (_) {
        return false;
      }
    } finally {
      pending = null;
      _notify();
    }
  }

  Future<MockInterview?> _run(Future<MockInterview> Function() call) async {
    if (busy) return null;
    busy = true;
    actionError = null;
    _poll?.cancel();
    _notify();
    try {
      final next = await call();
      _show(next);
      return next;
    } catch (error) {
      actionError = prepErrorMessage(error);
      // The server may have moved on anyway (a reply that arrived late).
      unawaited(load());
      return null;
    } finally {
      busy = false;
      _notify();
    }
  }

  /// Retries the interviewer's reply to the last answer.
  Future<void> reply() => _run(() => api.replyMockInterview(_id));

  /// Ends the interview now; the report is written in the background.
  Future<void> finish() => _run(() => api.finishMockInterview(_id));

  /// Writes a failed report again.
  Future<void> retryReport() => _run(() => api.retryMockReport(_id));

  /// Starts a new mock interview for the same prep (abandoning one in
  /// progress); this screen then shows it.
  Future<bool> restart() async {
    final prepId = interview?.prepId;
    if (prepId == null || prepId.isEmpty) return false;
    return await _run(() => api.startMockInterview(prepId, restart: true)) !=
        null;
  }

  Future<bool> delete() async {
    if (busy) return false;
    busy = true;
    _notify();
    try {
      await api.deleteMockInterview(_id);
      _poll?.cancel();
      return true;
    } catch (error) {
      actionError = prepErrorMessage(error);
      return false;
    } finally {
      busy = false;
      _notify();
    }
  }

  void clearError() {
    if (actionError == null) return;
    actionError = null;
    _notify();
  }

  @override
  void dispose() {
    _disposed = true;
    _poll?.cancel();
    _changesSub?.cancel();
    super.dispose();
  }
}
