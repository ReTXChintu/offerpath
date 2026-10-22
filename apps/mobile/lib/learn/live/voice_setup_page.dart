import 'package:flutter/material.dart';

import '../../models/live_practice.dart';
import '../../state/voice_setup_controller.dart';
import '../../util/format.dart';
import '../../widgets/common.dart';
import '../ui.dart';
import 'voice_repository.dart';

/// Opens "Your voice".
Future<void> openVoiceSetup(
  BuildContext context,
  VoiceRepository voice, {
  bool beforeSession = false,
}) => Navigator.of(context).push(
  MaterialPageRoute<void>(
    builder: (_) => VoiceSetupPage(voice: voice, beforeSession: beforeSession),
  ),
);

/// "Your voice": the phone learns the user's voice so that, in live
/// practice, only the interviewer's questions get answers. Downloads the
/// speaker model once, records three sentences, and then tests the
/// voiceprint and tunes its threshold.
class VoiceSetupPage extends StatefulWidget {
  const VoiceSetupPage({
    required this.voice,
    this.beforeSession = false,
    super.key,
  });

  final VoiceRepository voice;

  /// Shown on its own before the first session: offers to skip it.
  final bool beforeSession;

  @override
  State<VoiceSetupPage> createState() => _VoiceSetupPageState();
}

class _VoiceSetupPageState extends State<VoiceSetupPage> {
  late final VoiceSetupController _c = VoiceSetupController(repo: widget.voice);

  @override
  void initState() {
    super.initState();
    _c.addListener(_onChange);
    _c.load();
  }

  @override
  void dispose() {
    _c.removeListener(_onChange);
    _c.dispose();
    super.dispose();
  }

  void _onChange() {
    final error = _c.takeActionError();
    if (error != null && mounted) {
      ScaffoldMessenger.of(context)
          .showSnackBar(SnackBar(content: Text(error)));
    }
    if (mounted) setState(() {});
  }

  Future<void> _delete() async {
    final ok = await confirmDialog(
      context,
      title: 'Delete your voice?',
      message:
          'Live practice will answer every voice until you set it up again.',
      confirm: 'Delete',
    );
    if (ok) await _c.deleteVoice();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Your voice')),
      body: switch (_c.step) {
        VoiceStep.loading => const Center(child: CircularProgressIndicator()),
        VoiceStep.failed => LearnMessage(
          icon: Icons.error_outline,
          title: "Couldn't set up your voice",
          body: _c.error ?? '',
          action: 'Try again',
          onAction: _c.load,
        ),
        _ => ListView(
          padding: const EdgeInsets.fromLTRB(16, 16, 16, 40),
          children: [
            const _Intro(),
            const SizedBox(height: 16),
            switch (_c.step) {
              VoiceStep.model => _ModelStep(controller: _c),
              VoiceStep.ready => _ReadyStep(controller: _c, onDelete: _delete),
              _ => _EnrolStep(controller: _c),
            },
            if (widget.beforeSession && _c.step != VoiceStep.ready) ...[
              const SizedBox(height: 12),
              Align(
                alignment: Alignment.centerRight,
                child: TextButton(
                  onPressed: () => Navigator.of(context).pop(),
                  child: const Text('Not now'),
                ),
              ),
            ],
          ],
        ),
      },
    );
  }
}

class _Intro extends StatelessWidget {
  const _Intro();

  @override
  Widget build(BuildContext context) {
    final tone = LearnTone.of(context);
    return Text(
      "In live practice you're the interviewee and every other voice is the interviewer. "
      "Once the phone knows your voice, only the interviewer's questions get answers. "
      'The recordings stay on this phone; only a voiceprint (a list of numbers) is saved to your account.',
      style: TextStyle(fontSize: 13, color: tone.muted, height: 1.5),
    );
  }
}

class _Heading extends StatelessWidget {
  const _Heading(this.text);

  final String text;

  @override
  Widget build(BuildContext context) => Text(
    text,
    style: TextStyle(
      fontSize: 16,
      fontWeight: FontWeight.w800,
      color: LearnTone.of(context).strong,
    ),
  );
}

/// Step 1: the speaker model.
class _ModelStep extends StatelessWidget {
  const _ModelStep({required this.controller});

  final VoiceSetupController controller;

  @override
  Widget build(BuildContext context) {
    final tone = LearnTone.of(context);
    final c = controller;
    final size = c.model?.sizeBytes ?? 0;
    return LearnPanel(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          const _Heading('Step 1 of 2: the voice model'),
          const SizedBox(height: 6),
          Text(
            'The phone recognises your voice with a small model it downloads once'
            '${size > 0 ? ' (${_megabytes(size)})' : ''}.',
            style: TextStyle(fontSize: 13, color: tone.body, height: 1.5),
          ),
          const SizedBox(height: 14),
          if (c.downloading) ...[
            ClipRRect(
              borderRadius: BorderRadius.circular(4),
              child: LinearProgressIndicator(
                value: c.progress,
                minHeight: 8,
                backgroundColor: tone.line,
                semanticsLabel: 'Download progress',
              ),
            ),
            const SizedBox(height: 6),
            Text(
              c.progress == null
                  ? 'Downloading…'
                  : 'Downloading… ${(c.progress! * 100).round()}%',
              style: TextStyle(fontSize: 12, color: tone.muted),
            ),
          ] else
            FilledButton.icon(
              onPressed: c.downloadModel,
              icon: const Icon(Icons.download),
              label: Text(
                size > 0 ? 'Download (${_megabytes(size)})' : 'Download',
              ),
            ),
          if (c.error != null) ...[
            const SizedBox(height: 10),
            Text(
              c.error!,
              style: TextStyle(fontSize: 13, color: tone.fail, height: 1.4),
            ),
          ],
        ],
      ),
    );
  }
}

/// A level meter and how long it's been recording.
class _Meter extends StatelessWidget {
  const _Meter({required this.controller, required this.max});

  final VoiceSetupController controller;
  final Duration max;

  @override
  Widget build(BuildContext context) {
    final tone = LearnTone.of(context);
    final on = controller.recording;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        ValueListenableBuilder<double>(
          valueListenable: controller.level,
          builder: (context, level, _) => ClipRRect(
            borderRadius: BorderRadius.circular(4),
            child: LinearProgressIndicator(
              value: on ? level : 0,
              minHeight: 8,
              backgroundColor: tone.line,
              semanticsLabel: 'Input level',
            ),
          ),
        ),
        const SizedBox(height: 6),
        ValueListenableBuilder<Duration>(
          valueListenable: controller.elapsed,
          builder: (context, elapsed, _) => Text(
            on
                ? 'Recording… ${(elapsed.inMilliseconds / 1000).toStringAsFixed(1)} s of ${max.inSeconds} s'
                : controller.processing
                ? 'Checking…'
                : ' ',
            style: TextStyle(fontSize: 12, color: tone.muted),
          ),
        ),
      ],
    );
  }
}

/// A record / stop button.
class _RecordButton extends StatelessWidget {
  const _RecordButton({
    required this.recording,
    required this.busy,
    required this.label,
    required this.onRecord,
    required this.onStop,
  });

  final bool recording;
  final bool busy;
  final String label;
  final VoidCallback onRecord;
  final VoidCallback onStop;

  @override
  Widget build(BuildContext context) {
    if (recording) {
      return FilledButton.icon(
        onPressed: onStop,
        icon: const Icon(Icons.stop),
        label: const Text('Stop'),
      );
    }
    return FilledButton.icon(
      onPressed: busy ? null : onRecord,
      icon: busy
          ? const SizedBox(
              width: 16,
              height: 16,
              child: CircularProgressIndicator(strokeWidth: 2),
            )
          : const Icon(Icons.mic),
      label: Text(label),
    );
  }
}

/// Step 2: three sentences.
class _EnrolStep extends StatelessWidget {
  const _EnrolStep({required this.controller});

  final VoiceSetupController controller;

  @override
  Widget build(BuildContext context) {
    final tone = LearnTone.of(context);
    final c = controller;
    return LearnPanel(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          const _Heading('Step 2 of 2: read three sentences'),
          if (c.profileOutdated)
            Callout(
              icon: Icons.update,
              color: LearnTone.warn,
              title: 'Record your voice again',
              message: 'The voice model changed, so your old voiceprint no longer matches.',
            ),
          const SizedBox(height: 6),
          Text(
            'Read each one out loud in your normal voice, about where the phone will be.',
            style: TextStyle(fontSize: 13, color: tone.body, height: 1.5),
          ),
          const SizedBox(height: 14),
          Text(
            c.takesDone
                ? 'All three recorded'
                : 'Sentence ${c.take + 1} of ${voiceSentences.length}',
            style: TextStyle(
              fontSize: 12,
              fontWeight: FontWeight.w700,
              color: tone.muted,
            ),
          ),
          const SizedBox(height: 6),
          if (!c.takesDone)
            Container(
              key: const ValueKey('voice-sentence'),
              padding: const EdgeInsets.all(14),
              decoration: BoxDecoration(
                color: tone.raised,
                borderRadius: BorderRadius.circular(10),
              ),
              child: Text(
                '“${c.sentence}”',
                style: TextStyle(
                  fontSize: 17,
                  fontWeight: FontWeight.w600,
                  color: tone.strong,
                  height: 1.4,
                ),
              ),
            ),
          const SizedBox(height: 12),
          _Meter(controller: c, max: c.maxTake),
          if (c.takeProblem != null) ...[
            const SizedBox(height: 8),
            Text(
              c.takeProblem!,
              key: const ValueKey('voice-take-problem'),
              style: TextStyle(fontSize: 13, color: tone.fail, height: 1.4),
            ),
          ],
          if (c.error != null) ...[
            const SizedBox(height: 8),
            Text(
              c.error!,
              style: TextStyle(fontSize: 13, color: tone.fail, height: 1.4),
            ),
          ],
          const SizedBox(height: 12),
          if (c.takesDone)
            FilledButton.icon(
              onPressed: c.saving ? null : c.saveVoiceprint,
              icon: c.saving
                  ? const SizedBox(
                      width: 16,
                      height: 16,
                      child: CircularProgressIndicator(strokeWidth: 2),
                    )
                  : const Icon(Icons.save_outlined),
              label: Text(c.saving ? 'Saving…' : 'Save my voice'),
            )
          else
            _RecordButton(
              recording: c.recordingTake,
              busy: c.processing,
              label: c.take == 0 ? 'Record' : 'Record the next one',
              onRecord: c.recordTake,
              onStop: c.stopRecording,
            ),
          if (c.profile != null && !c.profileOutdated && !c.recording) ...[
            const SizedBox(height: 4),
            TextButton(
              onPressed: c.cancelRecordAgain,
              child: const Text('Keep my saved voice'),
            ),
          ],
        ],
      ),
    );
  }
}

/// The voiceprint is saved: test it, tune the threshold, record again or
/// delete it.
class _ReadyStep extends StatelessWidget {
  const _ReadyStep({required this.controller, required this.onDelete});

  final VoiceSetupController controller;
  final VoidCallback onDelete;

  @override
  Widget build(BuildContext context) {
    final tone = LearnTone.of(context);
    final c = controller;
    final similarity = c.testSimilarity;
    final recognised = c.testRecognised;
    final updated = c.profile?.updatedAt;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        LearnPanel(
          child: Row(
            children: [
              const Icon(Icons.record_voice_over, color: LearnTone.pass),
              const SizedBox(width: 12),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    const _Heading('Your voice is set up'),
                    if (updated != null)
                      Text(
                        'Recorded ${formatDateTime(context, updated)}',
                        style: TextStyle(fontSize: 12, color: tone.muted),
                      ),
                  ],
                ),
              ),
            ],
          ),
        ),
        const SizedBox(height: 16),
        LearnPanel(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              const _Heading('Test it'),
              const SizedBox(height: 6),
              Text(
                'Say a phrase, or ask your partner to, and see whether it sounds like you.',
                style: TextStyle(fontSize: 13, color: tone.body, height: 1.5),
              ),
              const SizedBox(height: 12),
              _Meter(controller: c, max: c.maxTest),
              if (c.takeProblem != null) ...[
                const SizedBox(height: 8),
                Text(
                  c.takeProblem!,
                  key: const ValueKey('voice-take-problem'),
                  style: TextStyle(fontSize: 13, color: tone.fail, height: 1.4),
                ),
              ],
              if (similarity != null && recognised != null) ...[
                const SizedBox(height: 8),
                Container(
                  key: const ValueKey('voice-verdict'),
                  padding: const EdgeInsets.all(12),
                  decoration: BoxDecoration(
                    color: (recognised ? LearnTone.pass : tone.accent)
                        .withValues(alpha: 0.1),
                    borderRadius: BorderRadius.circular(10),
                  ),
                  child: Row(
                    children: [
                      Icon(
                        recognised ? Icons.person : Icons.person_outline,
                        color: recognised ? LearnTone.pass : tone.accent,
                      ),
                      const SizedBox(width: 10),
                      Expanded(
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Text(
                              recognised
                                  ? 'Recognised as you'
                                  : 'Another voice',
                              style: TextStyle(
                                fontSize: 15,
                                fontWeight: FontWeight.w700,
                                color: tone.strong,
                              ),
                            ),
                            Text(
                              'Similarity ${similarity.toStringAsFixed(2)} · threshold ${c.threshold.toStringAsFixed(2)}',
                              style: TextStyle(fontSize: 12, color: tone.muted),
                            ),
                          ],
                        ),
                      ),
                    ],
                  ),
                ),
              ],
              const SizedBox(height: 12),
              _RecordButton(
                recording: c.recordingTest,
                busy: c.processing,
                label: 'Test',
                onRecord: c.recordTest,
                onStop: c.stopRecording,
              ),
            ],
          ),
        ),
        const SizedBox(height: 16),
        LearnPanel(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Row(
                children: [
                  const Expanded(child: _Heading('Match threshold')),
                  if (c.savingThreshold)
                    const SizedBox(
                      width: 14,
                      height: 14,
                      child: CircularProgressIndicator(strokeWidth: 2),
                    ),
                  const SizedBox(width: 8),
                  Text(
                    c.threshold.toStringAsFixed(2),
                    style: TextStyle(
                      fontSize: 15,
                      fontWeight: FontWeight.w700,
                      color: tone.strong,
                    ),
                  ),
                ],
              ),
              Slider(
                key: const ValueKey('voice-threshold'),
                value: c.threshold,
                min: voiceThresholdMin,
                max: voiceThresholdMax,
                divisions: 60,
                label: c.threshold.toStringAsFixed(2),
                onChanged: c.previewThreshold,
                onChangeEnd: c.saveThreshold,
              ),
              Text(
                'A turn at least this similar to your voice counts as yours and gets no answer. '
                'Raise it if your partner is taken for you; lower it if you get answers to your own words.',
                style: TextStyle(fontSize: 12, color: tone.muted, height: 1.5),
              ),
            ],
          ),
        ),
        const SizedBox(height: 16),
        Row(
          children: [
            Expanded(
              child: OutlinedButton.icon(
                onPressed: c.recording || c.processing ? null : c.recordAgain,
                icon: const Icon(Icons.refresh),
                label: const Text('Record again'),
              ),
            ),
            const SizedBox(width: 12),
            Expanded(
              child: OutlinedButton.icon(
                onPressed: c.deleting || c.recording ? null : onDelete,
                style: OutlinedButton.styleFrom(foregroundColor: tone.fail),
                icon: const Icon(Icons.delete_outline),
                label: const Text('Delete'),
              ),
            ),
          ],
        ),
      ],
    );
  }
}

/// Whether the account has a voiceprint, for the "Your voice" card.
String voiceStatusLabel(VoiceProfile? profile) =>
    profile == null ? 'Not set up' : 'Set up';

/// 26214400 → "25 MB".
String _megabytes(int bytes) {
  final mb = bytes / (1024 * 1024);
  return mb >= 10 ? '${mb.round()} MB' : '${mb.toStringAsFixed(1)} MB';
}
