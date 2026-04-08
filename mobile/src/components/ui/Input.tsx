import React, { useState, forwardRef } from 'react';
import {
  TextInput,
  TextInputProps,
  View,
  StyleSheet,
  TouchableOpacity,
} from 'react-native';
import { colors, spacing, radius, layout, textVariants } from '@/theme';
import { Text } from './Text';

interface InputProps extends TextInputProps {
  label?: string;
  error?: string;
  hint?: string;
  leftIcon?: React.ReactNode;
  rightElement?: React.ReactNode;
}

export const Input = forwardRef<TextInput, InputProps>(({
  label,
  error,
  hint,
  leftIcon,
  rightElement,
  style,
  ...props
}, ref) => {
  const [focused, setFocused] = useState(false);
  const hasError = !!error;

  const borderColor = hasError
    ? colors.border.error
    : focused
    ? colors.primary
    : colors.border.default;

  return (
    <View style={styles.wrapper}>
      {label && (
        <Text variant="label" color={colors.text.secondary} style={styles.label}>
          {label}
        </Text>
      )}
      <View
        style={[
          styles.inputContainer,
          { borderColor },
          style,
        ]}
      >
        {leftIcon && <View style={styles.leftIcon}>{leftIcon}</View>}
        <TextInput
          ref={ref}
          style={[
            styles.input,
            leftIcon ? { paddingLeft: 0 } : null,
          ]}
          placeholderTextColor={colors.text.tertiary}
          selectionColor={colors.primary}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          {...props}
        />
        {rightElement && <View style={styles.rightElement}>{rightElement}</View>}
      </View>
      {hasError && (
        <Text variant="caption" color={colors.text.error} style={styles.errorText}>
          {error}
        </Text>
      )}
      {hint && !hasError && (
        <Text variant="caption" color={colors.text.secondary} style={styles.hint}>
          {hint}
        </Text>
      )}
    </View>
  );
});

Input.displayName = 'Input';

const styles = StyleSheet.create({
  wrapper: {
    width: '100%',
  },
  label: {
    marginBottom: spacing[2],
  },
  inputContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.bg.input,
    borderWidth: 1,
    borderRadius: 8,
    height: layout.inputHeight,
    paddingHorizontal: spacing[4],
  },
  input: {
    flex: 1,
    ...textVariants.body,
    color: colors.text.primary,
    height: '100%',
  },
  leftIcon: {
    marginRight: spacing[3],
  },
  rightElement: {
    marginLeft: spacing[2],
  },
  errorText: {
    marginTop: spacing[1],
  },
  hint: {
    marginTop: spacing[1],
  },
});
