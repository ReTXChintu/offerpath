import 'package:flutter/material.dart';

/// A password field with the show/hide eye button every Offerpath password
/// field has, labelled "Show password" / "Hide password" for screen readers
/// and as its tooltip.
class PasswordField extends StatefulWidget {
  const PasswordField({required this.controller, this.label = 'Password', this.validator, this.onSubmitted, this.textInputAction, this.autofillHints = const [AutofillHints.password], super.key});

  final TextEditingController controller;
  final String label;
  final FormFieldValidator<String>? validator;
  final ValueChanged<String>? onSubmitted;
  final TextInputAction? textInputAction;
  final Iterable<String> autofillHints;

  @override
  State<PasswordField> createState() => _PasswordFieldState();
}

class _PasswordFieldState extends State<PasswordField> {
  bool _visible = false;

  @override
  Widget build(BuildContext context) {
    final label = _visible ? 'Hide password' : 'Show password';
    return TextFormField(
      controller: widget.controller,
      obscureText: !_visible,
      enableSuggestions: false,
      autocorrect: false,
      autofillHints: widget.autofillHints,
      textInputAction: widget.textInputAction,
      onFieldSubmitted: widget.onSubmitted,
      validator: widget.validator,
      decoration: InputDecoration(
        labelText: widget.label,
        suffixIcon: IconButton(
          tooltip: label,
          icon: Icon(_visible ? Icons.visibility_off_outlined : Icons.visibility_outlined, semanticLabel: label),
          onPressed: () => setState(() => _visible = !_visible),
        ),
      ),
    );
  }
}
