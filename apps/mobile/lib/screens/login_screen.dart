import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../config.dart';
import '../state/auth_controller.dart';
import '../widgets/common.dart';
import '../widgets/password_field.dart';
import 'pairing_scan_screen.dart';

/// Signing this phone in. Pairing with the code the desktop shows (scan the
/// QR) is the main way; email and password is the other (a new account, a
/// reinstall, a second phone while the desktop is out of reach). Either way
/// the phone ends up with one device token and keeps nothing else.
class LoginScreen extends StatefulWidget {
  const LoginScreen({super.key});

  @override
  State<LoginScreen> createState() => _LoginScreenState();
}

class _LoginScreenState extends State<LoginScreen> with SingleTickerProviderStateMixin {
  late final TabController _tab = TabController(length: 2, vsync: this);
  final _serverCtrl = TextEditingController();
  final _nameCtrl = TextEditingController();
  final _emailCtrl = TextEditingController();
  final _passwordCtrl = TextEditingController();
  final _deviceNameCtrl = TextEditingController();
  final _formKey = GlobalKey<FormState>();
  bool _isRegister = false;

  @override
  void dispose() {
    _tab.dispose();
    _serverCtrl.dispose();
    _nameCtrl.dispose();
    _emailCtrl.dispose();
    _passwordCtrl.dispose();
    _deviceNameCtrl.dispose();
    super.dispose();
  }

  String get _serverUrl => hasBuiltInServer ? kBuiltInServerUrl : _serverCtrl.text;

  Future<void> _submit() async {
    if (!_formKey.currentState!.validate()) return;
    final auth = context.read<AuthController>();
    final ok = _isRegister
        ? await auth.signUp(serverUrl: _serverUrl, displayName: _nameCtrl.text, email: _emailCtrl.text, password: _passwordCtrl.text, deviceName: _deviceNameCtrl.text)
        : await auth.signIn(serverUrl: _serverUrl, email: _emailCtrl.text, password: _passwordCtrl.text, deviceName: _deviceNameCtrl.text);
    if (ok && mounted) {
      ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Signed in.')));
    }
  }

  @override
  Widget build(BuildContext context) {
    final auth = context.watch<AuthController>();
    final theme = Theme.of(context);
    return Scaffold(
      appBar: AppBar(
        title: const Row(children: [BrandLogo(size: 30), SizedBox(width: 10), Text('Offerpath')]),
        bottom: TabBar(controller: _tab, tabs: const [Tab(text: 'Pair with code'), Tab(text: 'Email + password')]),
      ),
      body: TabBarView(
        controller: _tab,
        children: [
          const PairingScanScreen(),
          SingleChildScrollView(
            padding: const EdgeInsets.all(20),
            child: AutofillGroup(
              child: Form(
                key: _formKey,
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    const SizedBox(height: 8),
                    Text(
                      'Sign in with your Offerpath account. Pairing with the code on your desktop is quicker if it is nearby.',
                      style: theme.textTheme.bodySmall?.copyWith(color: theme.colorScheme.onSurfaceVariant),
                    ),
                    const SizedBox(height: 20),
                    if (!hasBuiltInServer) ...[
                      TextFormField(
                        controller: _serverCtrl,
                        decoration: const InputDecoration(labelText: 'Server URL', hintText: 'http://192.168.1.10:50005'),
                        keyboardType: TextInputType.url,
                        autocorrect: false,
                        validator: (v) => (v == null || v.trim().isEmpty) ? 'Required' : null,
                      ),
                      const SizedBox(height: 12),
                    ],
                    if (_isRegister) ...[
                      TextFormField(
                        controller: _nameCtrl,
                        decoration: const InputDecoration(labelText: 'Your name'),
                        textCapitalization: TextCapitalization.words,
                        autofillHints: const [AutofillHints.name],
                        validator: (v) => (v == null || v.trim().isEmpty) ? 'Required' : null,
                      ),
                      const SizedBox(height: 12),
                    ],
                    TextFormField(
                      controller: _emailCtrl,
                      decoration: const InputDecoration(labelText: 'Email'),
                      keyboardType: TextInputType.emailAddress,
                      autocorrect: false,
                      autofillHints: const [AutofillHints.email],
                      validator: (v) => (v == null || !v.contains('@')) ? 'Enter your email' : null,
                    ),
                    const SizedBox(height: 12),
                    PasswordField(
                      controller: _passwordCtrl,
                      autofillHints: _isRegister ? const [AutofillHints.newPassword] : const [AutofillHints.password],
                      validator: (v) {
                        if (v == null || v.isEmpty) return 'Required';
                        if (_isRegister && v.length < 8) return 'Use at least 8 characters';
                        return null;
                      },
                    ),
                    const SizedBox(height: 12),
                    TextFormField(
                      controller: _deviceNameCtrl,
                      decoration: const InputDecoration(labelText: 'Device name (optional)', hintText: 'My phone'),
                    ),
                    const SizedBox(height: 8),
                    SwitchListTile(
                      contentPadding: EdgeInsets.zero,
                      title: const Text('Create a new account'),
                      subtitle: const Text('Off signs in to an existing account'),
                      value: _isRegister,
                      onChanged: (v) => setState(() => _isRegister = v),
                    ),
                    if (auth.lastError != null) ...[
                      const SizedBox(height: 8),
                      Text(auth.lastError!, style: TextStyle(color: theme.colorScheme.error)),
                    ],
                    const SizedBox(height: 16),
                    FilledButton(
                      onPressed: auth.isBusy ? null : _submit,
                      child: auth.isBusy ? const SizedBox(width: 20, height: 20, child: CircularProgressIndicator(strokeWidth: 2)) : Text(_isRegister ? 'Create account' : 'Sign in'),
                    ),
                  ],
                ),
              ),
            ),
          ),
        ],
      ),
    );
  }
}
