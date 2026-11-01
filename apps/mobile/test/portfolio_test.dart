import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:offerpath_mobile/logic/links.dart';
import 'package:offerpath_mobile/models/app_notification.dart';
import 'package:offerpath_mobile/models/portfolio.dart';
import 'package:offerpath_mobile/screens/more_screen.dart';
import 'package:offerpath_mobile/screens/portfolio_messages_screen.dart';
import 'package:offerpath_mobile/screens/portfolio_screen.dart';
import 'package:offerpath_mobile/screens/shell_screen.dart';
import 'package:offerpath_mobile/services/link_bus.dart';
import 'package:offerpath_mobile/state/auth_controller.dart';
import 'package:offerpath_mobile/state/nav_controller.dart';
import 'package:offerpath_mobile/state/portfolio_controller.dart';
import 'package:offerpath_mobile/state/queue_controller.dart';
import 'package:offerpath_mobile/state/update_controller.dart';
import 'package:provider/provider.dart';

import 'support/fake_api.dart';
import 'support/fakes.dart';
import 'support/portfolio_fixtures.dart';

/// What the server sends for a new contact message: the hub `notification`
/// frame, and the same fields as a Firebase push's `data` (strings).
final _frame = <String, dynamic>{
  'id': 'n-m1',
  'level': 'INFO',
  'kind': 'PORTFOLIO_MESSAGE',
  'title': 'New message from Ravi Kumar',
  'body': 'Hi Asha, loved the Offerpath project.',
  'linkPage': 'portfolio-messages',
  'linkId': 'm1',
  'createdAt': '2026-10-23T08:00:00.000Z',
};

void main() {
  group('PORTFOLIO_MESSAGE links', () {
    test('open the message from every path: hub frame, local notification, Firebase data', () {
      expect(
        resolveLink('portfolio-messages', 'm1'),
        const AppLink(LinkKind.portfolioMessage, 'm1'),
      );
      expect(
        resolveLink('portfolio-messages', ''),
        const AppLink(LinkKind.portfolioMessages),
        reason: 'no id: the inbox',
      );
      expect(
        resolveLink('portfolio_messages', null),
        const AppLink(LinkKind.portfolioMessages),
      );
      expect(
        AppNotification.fromJson(_frame).link,
        const AppLink(LinkKind.portfolioMessage, 'm1'),
      );
      expect(
        decodeLinkPayload(encodeLinkPayload('portfolio-messages', 'm1')),
        const AppLink(LinkKind.portfolioMessage, 'm1'),
      );
      expect(
        linkFromPushData(_frame.map((k, v) => MapEntry(k, v.toString()))),
        const AppLink(LinkKind.portfolioMessage, 'm1'),
      );
      expect(tabFor(const AppLink(LinkKind.portfolioMessage, 'm1')), tabMore);
      expect(tabFor(const AppLink(LinkKind.portfolioMessages)), tabMore);
    });
  });

  group('portfolio screens', () {
    late FakeApi fake;
    late AuthController auth;
    late NavController nav;
    late PortfolioController portfolio;

    Future<void> start(WidgetTester tester, FakeApi api) async {
      tester.view.physicalSize = const Size(1080, 2400);
      tester.view.devicePixelRatio = 2;
      addTearDown(tester.view.reset);
      fake = api;
      auth = await signedInAuth(fake);
      nav = NavController();
      portfolio = PortfolioController(auth, pushes: const Stream.empty());
    }

    Widget host(Widget child) => MultiProvider(
      providers: [
        ChangeNotifierProvider<AuthController>.value(value: auth),
        ChangeNotifierProvider<NavController>.value(value: nav),
        ChangeNotifierProvider<PortfolioController>.value(value: portfolio),
      ],
      child: MaterialApp(home: child),
    );

    testWidgets(
      'no portfolio yet: says to set it up on the website or laptop app',
      (tester) async {
        await start(tester, portfolioApi(exists: false));
        await tester.pumpWidget(host(const PortfolioScreen()));
        await tester.pumpAndSettle();
        expect(
          find.text('Set up your portfolio on the website or laptop app'),
          findsOneWidget,
        );
        expect(find.text('Messages'), findsNothing);
      },
    );

    testWidgets('the overview shows the handle, counts, and the two ways in', (
      tester,
    ) async {
      await start(tester, portfolioApi());
      await tester.pumpWidget(host(const PortfolioScreen()));
      await tester.pumpAndSettle();
      expect(find.text('@asha'), findsOneWidget);
      expect(find.text('Asha Rao'), findsOneWidget);
      expect(find.text('Unread messages'), findsOneWidget);
      expect(find.text('Developer tools'), findsOneWidget);
      expect(find.text('1 unread from your contact form'), findsOneWidget);
      expect(find.text('2 drafts waiting to be published'), findsOneWidget);

      await tester.tap(find.text('Messages'));
      await tester.pumpAndSettle();
      expect(find.byType(PortfolioMessagesScreen), findsOneWidget);
      expect(find.text('Ravi Kumar'), findsOneWidget);
    });

    testWidgets('More lists Portfolio with the unread count', (tester) async {
      await start(tester, portfolioApi());
      final offline = AuthController();
      await tester.pumpWidget(
        MultiProvider(
          providers: [
            ChangeNotifierProvider<AuthController>.value(value: auth),
            ChangeNotifierProvider<PortfolioController>.value(value: portfolio),
            ChangeNotifierProvider<QueueController>(
              create: (_) => QueueController(FakeConnectionController(offline)),
            ),
            ChangeNotifierProvider<UpdateController>(
              create: (_) => UpdateController(offline),
            ),
          ],
          child: const MaterialApp(home: MoreScreen()),
        ),
      );
      await tester.pumpAndSettle();
      expect(find.text('Portfolio'), findsOneWidget);
      expect(find.text('1 unread message from your site'), findsOneWidget);
      await tester.tap(find.text('Portfolio'));
      await tester.pumpAndSettle();
      expect(find.byType(PortfolioScreen), findsOneWidget);
    });

    testWidgets('inbox: opening a message marks it read; delete asks first', (
      tester,
    ) async {
      await start(
        tester,
        portfolioApi(
          messages: [
            messageJson(),
            messageJson(
              id: 'm2',
              name: 'Meera',
              read: true,
              createdAt: '2026-10-20T00:00:00Z',
            ),
          ],
        ),
      );
      fake
        ..on(
          'PATCH',
          '/api/v1/portfolio/messages/m1',
          FakeReply.ok(messageJson(read: true)),
        )
        ..on('DELETE', '/api/v1/portfolio/messages/m1', const FakeReply(204));
      await tester.pumpWidget(host(const PortfolioMessagesScreen()));
      await tester.pumpAndSettle();
      expect(find.text('Messages (1)'), findsOneWidget);
      expect(find.text('Meera'), findsOneWidget);
      expect(find.byKey(const ValueKey('unread-dot')), findsOneWidget);

      await tester.tap(find.text('Ravi Kumar'));
      await tester.pumpAndSettle();
      expect(find.byType(PortfolioMessagePage), findsOneWidget);
      expect(
        find.textContaining('Are you open to a contract role?'),
        findsOneWidget,
        reason: 'the full text',
      );
      final patch = fake.requests.lastWhere((r) => r.method == 'PATCH');
      expect(patch.path, '/api/v1/portfolio/messages/m1');
      expect(patch.body, {'read': true});

      await tester.tap(find.byTooltip('Delete'));
      await tester.pumpAndSettle();
      expect(find.text('Delete this message?'), findsOneWidget);
      await tester.tap(find.widgetWithText(FilledButton, 'Delete'));
      await tester.pumpAndSettle();
      expect(fake.requests.last.method, 'DELETE');
      expect(
        find.byType(PortfolioMessagePage),
        findsNothing,
        reason: 'back to the inbox',
      );
      expect(find.text('Ravi Kumar'), findsNothing);
      expect(
        find.text('Messages'),
        findsOneWidget,
        reason: 'nothing unread now',
      );
    });

    testWidgets(
      'inbox: mark unread from the row menu; cancelling delete keeps it',
      (tester) async {
        await start(tester, portfolioApi(messages: [messageJson(read: true)]));
        fake.on(
          'PATCH',
          '/api/v1/portfolio/messages/m1',
          FakeReply.ok(messageJson(read: false)),
        );
        await tester.pumpWidget(host(const PortfolioMessagesScreen()));
        await tester.pumpAndSettle();
        expect(find.byKey(const ValueKey('unread-dot')), findsNothing);

        await tester.tap(find.byTooltip('Message actions'));
        await tester.pumpAndSettle();
        await tester.tap(find.text('Mark as unread'));
        await tester.pumpAndSettle();
        expect(fake.requests.last.body, {'read': false});
        expect(find.byKey(const ValueKey('unread-dot')), findsOneWidget);

        await tester.tap(find.byTooltip('Message actions'));
        await tester.pumpAndSettle();
        await tester.tap(find.text('Delete'));
        await tester.pumpAndSettle();
        await tester.tap(find.text('Cancel'));
        await tester.pumpAndSettle();
        expect(fake.requests.any((r) => r.method == 'DELETE'), isFalse);
        expect(find.text('Ravi Kumar'), findsOneWidget);
      },
    );

    testWidgets('tapping the email opens a mail compose', (tester) async {
      await start(tester, portfolioApi());
      fake.on(
        'PATCH',
        '/api/v1/portfolio/messages/m1',
        FakeReply.ok(messageJson(read: true)),
      );
      final launched = <Uri>[];
      await tester.pumpWidget(
        host(
          PortfolioMessagePage(
            messageId: 'm1',
            launchMail: (uri) async {
              launched.add(uri);
              return true;
            },
          ),
        ),
      );
      await tester.pumpAndSettle();
      await tester.tap(find.text('ravi@example.com'));
      await tester.pumpAndSettle();
      expect(launched.single.scheme, 'mailto');
      expect(launched.single.path, 'ravi@example.com');
      expect(launched.single.query, contains('subject=Re%3A'));
    });

    testWidgets(
      'publishing: drafts only by default, From profile, the switch, and the no-image refusal',
      (tester) async {
        await start(tester, portfolioApi());
        fake.on(
          'PATCH',
          '/api/v1/portfolio/skills/s1',
          FakeReply.ok(skillJson(published: true)),
        );
        await tester.pumpWidget(host(const PortfolioPublishScreen()));
        await tester.pumpAndSettle();

        expect(find.text('Offerpath'), findsOneWidget);
        expect(find.text('Frontend'), findsOneWidget);
        expect(find.text('json-diff-cli'), findsOneWidget);
        expect(
          find.text('Senior engineer'),
          findsNothing,
          reason: 'published: hidden while Drafts only is on',
        );
        expect(
          find.text('From profile'),
          findsNWidgets(2),
          reason: 'the project and the skill came from the profile',
        );
        expect(
          find.text(portfolioNeedsImageMessage),
          findsOneWidget,
          reason: 'says why before the tap',
        );

        // The project has no image: refused, no request.
        final before = fake.requests.length;
        await tester.tap(find.byKey(const ValueKey('publish-projects-pr1')));
        await tester.pumpAndSettle();
        expect(fake.requests.length, before);
        expect(
          find.descendant(
            of: find.byType(SnackBar),
            matching: find.text(portfolioNeedsImageMessage),
          ),
          findsOneWidget,
        );
        expect(
          tester
              .widget<Switch>(
                find.byKey(const ValueKey('publish-projects-pr1')),
              )
              .value,
          isFalse,
        );

        // The skill publishes, and stays on screen so it can be undone.
        await tester.tap(find.byKey(const ValueKey('publish-skills-s1')));
        await tester.pumpAndSettle();
        final patch = fake.requests.last;
        expect(patch.method, 'PATCH');
        expect(patch.path, '/api/v1/portfolio/skills/s1');
        expect(patch.body, {'published': true});
        expect(
          tester
              .widget<Switch>(find.byKey(const ValueKey('publish-skills-s1')))
              .value,
          isTrue,
        );

        await tester.tap(find.text('Drafts only'));
        await tester.pumpAndSettle();
        expect(find.text('Senior engineer'), findsOneWidget);
      },
    );

    testWidgets(
      'a PORTFOLIO_MESSAGE tap opens the message over the inbox on More',
      (tester) async {
        await start(tester, portfolioApi());
        fake.on(
          'PATCH',
          '/api/v1/portfolio/messages/m1',
          FakeReply.ok(messageJson(read: true)),
        );
        await tester.pumpWidget(
          host(const AppLinkListener(child: Scaffold(body: Text('shell')))),
        );
        await tester.pumpAndSettle();

        LinkBus.instance.open(
          linkFromPushData({'linkPage': 'portfolio-messages', 'linkId': 'm1'}),
        );
        await tester.pumpAndSettle();
        expect(find.byType(PortfolioMessagePage), findsOneWidget);
        expect(
          find.textContaining('Are you open to a contract role?'),
          findsOneWidget,
        );
        expect(nav.tab, tabMore);
        expect(
          fake.requests.any(
            (r) =>
                r.method == 'PATCH' &&
                r.path == '/api/v1/portfolio/messages/m1',
          ),
          isTrue,
        );
        expect(LinkBus.instance.take(), isNull, reason: 'taken once');

        await tester.pageBack();
        await tester.pumpAndSettle();
        expect(find.byType(PortfolioMessagesScreen), findsOneWidget);
      },
    );

    testWidgets('a link to a message that is gone says so', (tester) async {
      await start(tester, portfolioApi(messages: []));
      await tester.pumpWidget(
        host(const PortfolioMessagePage(messageId: 'gone')),
      );
      await tester.pumpAndSettle();
      expect(find.text("This message isn't here any more"), findsOneWidget);
    });
  });
}
