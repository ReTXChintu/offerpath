import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:offerpath_mobile/learn/prep_create_page.dart';
import 'package:offerpath_mobile/learn/prep_detail_page.dart';
import 'package:offerpath_mobile/learn/voice.dart';
import 'package:offerpath_mobile/models/interview_prep.dart';

import '../support/fake_api.dart';
import '../support/prep_fixtures.dart';

void main() {
  group('validatePrepForm', () {
    final now = DateTime(2026, 10, 19, 12);
    Map<String, String> check({String company = '', String role = '', String jd = '', List<String> tech = const [], DateTime? date, int? minutes}) =>
        validatePrepForm(company: company, role: role, jobDescription: jd, technologies: tech, date: date, minutesOfDay: minutes, now: now);

    test('needs a job description or technologies, a date and a time', () {
      final errors = check();
      expect(errors['jobDescription'], 'Add the job description, or the technologies to prepare.');
      expect(errors['date'], 'Pick the interview date.');
      expect(errors['time'], 'Pick the interview time.');
    });

    test('technologies alone are enough', () {
      expect(check(tech: ['Go'], date: DateTime(2026, 10, 21), minutes: 600), isEmpty);
      expect(check(jd: 'A job', date: DateTime(2026, 10, 21), minutes: 600), isEmpty);
    });

    test('refuses a time that has passed and over-long fields', () {
      expect(check(tech: ['Go'], date: DateTime(2026, 10, 19), minutes: 9 * 60)['time'], 'That time has already passed.');
      expect(check(tech: ['Go'], date: DateTime(2026, 10, 19), minutes: 13 * 60), isEmpty);
      expect(check(company: 'x' * 121, tech: ['Go'], date: DateTime(2026, 10, 21), minutes: 600), contains('company'));
      expect(check(tech: List.generate(21, (i) => 't$i'), date: DateTime(2026, 10, 21), minutes: 600), contains('technologies'));
    });

    test('technologies split on commas and drop duplicates', () {
      expect(splitTechnologies('React, node ;SQL,,react', existing: ['Node']), ['React', 'SQL']);
    });
  });

  group('PrepCreatePage', () {
    Future<FakeApi> pump(WidgetTester tester, {Object? source}) async {
      tester.view.physicalSize = const Size(1080, 2400);
      tester.view.devicePixelRatio = 2;
      addTearDown(tester.view.reset);
      final fake = FakeApi()
        ..on('GET', '/api/v1/interview-preps/ai', FakeReply.ok({'source': source}))
        ..on('POST', '/api/v1/interview-preps', FakeReply.ok(prepJson(status: 'GENERATING')))
        ..on('GET', '/api/v1/interview-preps/p1', FakeReply.ok(prepJson(status: 'GENERATING')));
      await tester.pumpWidget(MaterialApp(home: PrepCreatePage(api: fake.client(), voice: FakeVoiceInput(available: false))));
      await tester.pumpAndSettle();
      return fake;
    }

    testWidgets('says AI will wait for the laptop when nothing can run it', (tester) async {
      await pump(tester);
      expect(find.text(prepAiSourceLine(null)), findsOneWidget);
      expect(find.textContaining('it will start when your laptop comes online'), findsOneWidget);
    });

    testWidgets('names the OpenAI key or the laptop when one can run it', (tester) async {
      await pump(tester, source: 'openai');
      expect(find.textContaining('your OpenAI key'), findsOneWidget);
    });

    testWidgets('an empty form shows what is missing and sends nothing', (tester) async {
      final fake = await pump(tester);
      await tester.tap(find.text('Prepare'));
      await tester.pumpAndSettle();
      expect(find.text('Add the job description, or the technologies to prepare.'), findsOneWidget);
      expect(find.text('Pick the interview date.'), findsOneWidget);
      expect(find.text('Pick the interview time.'), findsOneWidget);
      expect(fake.requests.where((r) => r.method == 'POST'), isEmpty);
    });

    testWidgets('technologies become chips, and a filled form is sent and opens the prep', (tester) async {
      final fake = await pump(tester, source: 'desktop');
      await tester.enterText(find.widgetWithText(TextField, 'Company'), 'Acme');
      final tech = find.widgetWithText(TextField, 'Technologies');
      await tester.enterText(tech, 'React, ');
      await tester.pump();
      await tester.enterText(tech, 'TypeScript');
      await tester.testTextInput.receiveAction(TextInputAction.done);
      await tester.pumpAndSettle();
      expect(find.widgetWithText(InputChip, 'React'), findsOneWidget);
      expect(find.widgetWithText(InputChip, 'TypeScript'), findsOneWidget);

      await tester.tap(find.text('Pick date'));
      await tester.pumpAndSettle();
      await tester.tap(find.text('OK'));
      await tester.pumpAndSettle();
      await tester.tap(find.text('Pick time'));
      await tester.pumpAndSettle();
      await tester.tap(find.text('OK'));
      await tester.pumpAndSettle();

      await tester.ensureVisible(find.text('Prepare'));
      await tester.tap(find.text('Prepare'));
      // The prep screen's progress bar never settles while it generates.
      for (var i = 0; i < 10; i++) {
        await tester.pump(const Duration(milliseconds: 100));
      }

      final post = fake.requests.singleWhere((r) => r.method == 'POST');
      final body = post.body as Map;
      expect(body['company'], 'Acme');
      expect(body['technologies'], ['React', 'TypeScript']);
      expect(body['jobDescription'], isNull);
      // The picker's defaults: tomorrow at 10:00, local, with the offset.
      final tomorrow = DateTime.now().add(const Duration(days: 1));
      final expected = DateTime(tomorrow.year, tomorrow.month, tomorrow.day, 10);
      expect(body['scheduledAt'], matches(RegExp(r'T10:00:00[+-]\d\d:\d\d$')));
      expect(DateTime.parse(body['scheduledAt'] as String).isAtSameMomentAs(expected), isTrue);

      expect(find.byType(PrepDetailPage), findsOneWidget);
      expect(find.text('Writing your plan and questions…'), findsOneWidget);
      // Leave no poll timer running.
      await tester.pumpWidget(const SizedBox.shrink());
    });

    testWidgets('a failed send keeps everything typed', (tester) async {
      final fake = await pump(tester);
      fake.offline = true;
      await tester.enterText(find.widgetWithText(TextField, 'Job description'), 'Senior Go engineer, Kafka, Postgres.');
      await tester.tap(find.text('Pick date'));
      await tester.pumpAndSettle();
      await tester.tap(find.text('OK'));
      await tester.pumpAndSettle();
      await tester.tap(find.text('Pick time'));
      await tester.pumpAndSettle();
      await tester.tap(find.text('OK'));
      await tester.pumpAndSettle();
      await tester.ensureVisible(find.text('Prepare'));
      await tester.tap(find.text('Prepare'));
      await tester.pumpAndSettle();
      expect(find.textContaining("Couldn't reach the Offerpath server"), findsOneWidget);
      expect(find.text('Senior Go engineer, Kafka, Postgres.'), findsOneWidget);
      expect(find.byType(PrepCreatePage), findsOneWidget);
    });
  });
}
