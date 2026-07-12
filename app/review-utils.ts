type WeeklyReviewInput = {
  nights: number;
  morePromptNights: number;
  lessPromptNights: number;
  adjustments: number;
  recentCompletedFirstStep?: string;
};

export type WeeklySuggestion = { id: string; icon: string; text: string; evidence: string };

export function suggestWeeklyFocus(input: WeeklyReviewInput): WeeklySuggestion {
  if (!input.nights) return { id: "observe", icon: "moon", text: "下一晚只完成一次不评价的温和收尾", evidence: "先留下一晚事实，再决定要不要改变。" };
  if (input.morePromptNights) return { id: "offer-choice", icon: "speech", text: "下一晚把催促换成：“继续、休息，还是调整？”", evidence: `本周有${input.morePromptNights}晚记录到催促感更多，先改变大人的一句话。` };
  if (input.adjustments >= Math.max(2, input.nights)) return { id: "leave-space", icon: "quiet", text: "下一晚安排时，先留出10分钟空白", evidence: `本周主动调整了${input.adjustments}次；提前留白，比临时赶时间更轻松。` };
  if (input.lessPromptNights && input.recentCompletedFirstStep) return { id: "keep-first-step", icon: "check", text: `继续把“${input.recentCompletedFirstStep}”放在容易开始的位置`, evidence: `本周有${input.lessPromptNights}晚催促感更少，先保留已经有效的第一步。` };
  return { id: "smaller-start", icon: "home-heart", text: "下一晚只把第一步再缩小一点", evidence: "一次只改一件事，更容易看清什么真正有帮助。" };
}
