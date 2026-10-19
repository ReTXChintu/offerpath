import 'package:flutter/material.dart';

import '../models/interview_prep.dart';
import '../services/api_client.dart';
import '../state/interview_prep_controller.dart';
import 'prep_detail_page.dart';
import 'prep_widgets.dart';
import 'ui.dart';
import 'voice.dart';

/// "Prepare for an interview": company, role, the job description (pasted),
/// technologies, and when the interview is. Before sending it says where AI
/// will run: Claude on the laptop, the user's OpenAI key, or nowhere yet (it
/// then starts when the laptop comes online). On success the prep's own
/// screen replaces this one.
class PrepCreatePage extends StatefulWidget {
  const PrepCreatePage({required this.api, this.preps, this.voice, super.key});

  final ApiClient api;
  final InterviewPrepController? preps;

  /// Passed on to the prep screen (for tests).
  final VoiceInput? voice;

  @override
  State<PrepCreatePage> createState() => _PrepCreatePageState();
}

class _PrepCreatePageState extends State<PrepCreatePage> {
  final _company = TextEditingController();
  final _role = TextEditingController();
  final _jobDescription = TextEditingController();
  final _technology = TextEditingController();
  final _technologies = <String>[];
  DateTime? _date;
  TimeOfDay? _time;

  late final Future<PrepAiSource?> _aiSource = widget.api.prepAiSource();
  Map<String, String> _errors = const {};
  String? _submitError;
  bool _busy = false;

  @override
  void dispose() {
    _company.dispose();
    _role.dispose();
    _jobDescription.dispose();
    _technology.dispose();
    super.dispose();
  }

  /// Moves what's in the technologies box into chips. Typing a comma (or
  /// pasting a list) adds them as you go.
  void _addTechnologies(String text, {bool all = true}) {
    var input = text;
    var rest = '';
    if (!all) {
      final cut = input.lastIndexOf(RegExp(r'[,;\n]'));
      if (cut < 0) return;
      rest = input.substring(cut + 1);
      input = input.substring(0, cut);
    }
    final added = splitTechnologies(input, existing: _technologies);
    setState(() {
      _technologies.addAll(added);
      _errors = Map.of(_errors)..remove('technologies');
      if (_technologies.isNotEmpty) _errors.remove('jobDescription');
    });
    _technology.value = TextEditingValue(text: rest, selection: TextSelection.collapsed(offset: rest.length));
  }

  int? get _minutes => _time == null ? null : _time!.hour * 60 + _time!.minute;

  Future<void> _submit() async {
    if (_busy) return;
    if (_technology.text.trim().isNotEmpty) _addTechnologies(_technology.text);
    final errors = validatePrepForm(
      company: _company.text,
      role: _role.text,
      jobDescription: _jobDescription.text,
      technologies: _technologies,
      date: _date,
      minutesOfDay: _minutes,
    );
    setState(() {
      _errors = errors;
      _submitError = null;
    });
    if (errors.isNotEmpty) return;

    final at = DateTime(_date!.year, _date!.month, _date!.day, _time!.hour, _time!.minute);
    setState(() => _busy = true);
    try {
      final prep = await widget.api.createPrep(
        company: _company.text,
        role: _role.text,
        jobDescription: _jobDescription.text,
        technologies: List.of(_technologies),
        scheduledAt: at,
      );
      if (!mounted) return;
      widget.preps?.put(prep);
      await Navigator.of(context).pushReplacement(MaterialPageRoute<void>(
        builder: (_) => PrepDetailPage(api: widget.api, prepId: prep.id, preps: widget.preps, voice: widget.voice),
      ));
    } catch (error) {
      // Everything typed stays where it is.
      if (mounted) setState(() => _submitError = prepErrorMessage(error));
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final tone = LearnTone.of(context);
    return Scaffold(
      appBar: AppBar(title: const Text('Prepare for an interview')),
      body: ListView(
        padding: const EdgeInsets.fromLTRB(16, 12, 16, 40),
        children: [
          Text(
            'Paste the job description, or list the technologies, and say when the interview is. AI writes a plan up to the day and the questions you are likely to get.',
            style: TextStyle(fontSize: 13, color: tone.muted, height: 1.5),
          ),
          const SizedBox(height: 16),
          LayoutBuilder(builder: (context, constraints) {
            final company = TextField(
              controller: _company,
              textCapitalization: TextCapitalization.words,
              textInputAction: TextInputAction.next,
              decoration: InputDecoration(labelText: 'Company', hintText: 'Acme', errorText: _errors['company']),
            );
            final role = TextField(
              controller: _role,
              textCapitalization: TextCapitalization.sentences,
              textInputAction: TextInputAction.next,
              decoration: InputDecoration(labelText: 'Role', hintText: 'Backend developer', errorText: _errors['role']),
            );
            // Side by side when there's room, stacked on a narrow phone.
            if (constraints.maxWidth >= 560) {
              return Row(crossAxisAlignment: CrossAxisAlignment.start, children: [Expanded(child: company), const SizedBox(width: 12), Expanded(child: role)]);
            }
            return Column(children: [company, const SizedBox(height: 12), role]);
          }),
          const SizedBox(height: 12),
          TextField(
            controller: _jobDescription,
            minLines: 6,
            maxLines: 16,
            keyboardType: TextInputType.multiline,
            textCapitalization: TextCapitalization.sentences,
            onChanged: (_) {
              if (_errors.containsKey('jobDescription')) setState(() => _errors = Map.of(_errors)..remove('jobDescription'));
            },
            decoration: InputDecoration(
              labelText: 'Job description',
              hintText: 'Paste the whole posting: responsibilities, requirements, the stack…',
              alignLabelWithHint: true,
              errorText: _errors['jobDescription'],
              errorMaxLines: 2,
            ),
          ),
          const SizedBox(height: 12),
          TextField(
            controller: _technology,
            textInputAction: TextInputAction.done,
            onChanged: (text) => _addTechnologies(text, all: false),
            onSubmitted: (text) => _addTechnologies(text),
            decoration: InputDecoration(
              labelText: 'Technologies',
              hintText: 'React, Node.js, PostgreSQL',
              helperText: 'Press enter or type a comma after each one.',
              errorText: _errors['technologies'],
              suffixIcon: IconButton(tooltip: 'Add technology', icon: const Icon(Icons.add), onPressed: () => _addTechnologies(_technology.text)),
            ),
          ),
          if (_technologies.isNotEmpty) ...[
            const SizedBox(height: 10),
            Wrap(spacing: 6, runSpacing: 6, children: [
              for (final t in _technologies)
                InputChip(
                  label: Text(t),
                  onDeleted: () => setState(() => _technologies.remove(t)),
                  deleteButtonTooltipMessage: 'Remove $t',
                ),
            ]),
          ],
          const SizedBox(height: 20),
          Text('When is the interview?', style: theme.textTheme.titleSmall?.copyWith(fontWeight: FontWeight.w700)),
          const SizedBox(height: 8),
          PrepWhenFields(
            date: _date,
            time: _time,
            dateError: _errors['date'],
            timeError: _errors['time'],
            onDate: (d) => setState(() {
              _date = d;
              _errors = Map.of(_errors)
                ..remove('date')
                ..remove('time');
            }),
            onTime: (t) => setState(() {
              _time = t;
              _errors = Map.of(_errors)..remove('time');
            }),
          ),
          const SizedBox(height: 4),
          Text('Your local time.', style: TextStyle(fontSize: 11.5, color: tone.muted)),
          const SizedBox(height: 20),
          FutureBuilder<PrepAiSource?>(
            future: _aiSource,
            builder: (context, snapshot) {
              if (snapshot.connectionState != ConnectionState.done) {
                return _AiLine(icon: Icons.hourglass_empty, text: 'Checking where AI will run…', color: tone.muted);
              }
              if (snapshot.hasError) return const SizedBox.shrink();
              final source = snapshot.data;
              return _AiLine(
                icon: switch (source) { PrepAiSource.desktop => Icons.laptop_mac, PrepAiSource.openai => Icons.key_outlined, null => Icons.schedule },
                text: prepAiSourceLine(source),
                color: source == null ? LearnTone.warn : tone.accent,
              );
            },
          ),
          if (_submitError != null) ...[
            const SizedBox(height: 12),
            Text(_submitError!, style: TextStyle(color: theme.colorScheme.error, height: 1.4)),
          ],
          const SizedBox(height: 16),
          FilledButton.icon(
            onPressed: _busy ? null : _submit,
            icon: _busy ? const SizedBox(width: 16, height: 16, child: CircularProgressIndicator(strokeWidth: 2)) : const Icon(Icons.auto_awesome),
            label: const Text('Prepare'),
          ),
        ],
      ),
    );
  }
}

class _AiLine extends StatelessWidget {
  const _AiLine({required this.icon, required this.text, required this.color});

  final IconData icon;
  final String text;
  final Color color;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
      decoration: BoxDecoration(color: color.withValues(alpha: 0.1), borderRadius: BorderRadius.circular(10)),
      child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Icon(icon, size: 18, color: color),
        const SizedBox(width: 10),
        Expanded(child: Text(text, style: TextStyle(color: LearnTone.of(context).body, fontSize: 13, height: 1.4))),
      ]),
    );
  }
}

/// Opens the create screen.
Future<void> openPrepCreate(BuildContext context, ApiClient api, {InterviewPrepController? preps}) =>
    Navigator.of(context).push(MaterialPageRoute<void>(builder: (_) => PrepCreatePage(api: api, preps: preps)));
