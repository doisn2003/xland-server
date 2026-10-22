// DRAFT v0.1; reviewed and locked by Agent A after B feedback.
import 'common.dart';
import '../value_objects/vnd.dart';
import '../value_objects/decimal_value.dart';

final class FinanceInput {
  const FinanceInput({
    required this.propertyId,
    required this.equityVnd,
    required this.loanVnd,
    required this.termMonths,
    required this.annualRatePercent,
    required this.method,
  });
  final String propertyId;
  final Vnd equityVnd;
  final Vnd loanVnd;
  final int termMonths;
  final DecimalValue annualRatePercent;
  final RepaymentMethod method;
}

final class FinanceResult {
  const FinanceResult({
    required this.input,
    required this.monthlyPaymentVnd,
    required this.firstMonthPrincipalVnd,
    required this.firstMonthInterestVnd,
    required this.totalInterestVnd,
    required this.totalRepaymentVnd,
    required this.formulaVersion,
    required this.roundingRule,
    required this.estimateNotice,
  });
  final FinanceInput input;
  final Vnd monthlyPaymentVnd;
  final Vnd firstMonthPrincipalVnd;
  final Vnd firstMonthInterestVnd;
  final Vnd totalInterestVnd;
  final Vnd totalRepaymentVnd;
  final String formulaVersion;
  final String roundingRule;
  final String estimateNotice;
}

final class SavedFinancePlan {
  const SavedFinancePlan({
    required this.id,
    required this.propertyId,
    required this.label,
    required this.input,
    this.result,
    required this.createdAt,
  });
  final String id;
  final String propertyId;
  final String label;
  final FinanceInput input;
  final FinanceResult? result;
  final DateTime createdAt;
}
