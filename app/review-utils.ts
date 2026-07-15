type WeeklyReviewInput = {
  nights: number;
  morePromptNights: number;
  lessPromptNights: number;
  adjustments: number;
  recentCompletedFirstStep?: string;
};

export type WeeklySuggestion = { id: string; icon: string; text: string; evidence: string };

export function suggestWeeklyFocus(input: WeeklyReviewInput): WeeklySuggestion {
  if (!input.nights) return { id: "observe", icon: "moon", text: "下一晚先完成一份最短共同计划", evidence: "先留下开始、完成与调整的真实记录，再决定下一步。" };
  if (input.morePromptNights) return { id: "offer-choice", icon: "speech", text: "下一晚把第一项写得更具体，并缩短5分钟", evidence: `本周有${input.morePromptNights}晚记录到共同执行更费力，先降低第一项的不确定性。` };
  if (input.adjustments >= Math.max(2, input.nights)) return { id: "leave-space", icon: "quiet", text: "下一晚安排时，预留10分钟机动时间", evidence: `本周主动调整了${input.adjustments}次；提前保留机动时间，计划更容易按时推进。` };
  if (input.lessPromptNights && input.recentCompletedFirstStep) return { id: "keep-first-step", icon: "check", text: `继续把“${input.recentCompletedFirstStep}”放在第一项`, evidence: `本周有${input.lessPromptNights}晚共同执行更顺畅，先保留已经有效的开始方式。` };
  return { id: "smaller-start", icon: "home-heart", text: "下一晚把第一项写成一个可直接执行的动作", evidence: "一次只改一个节点，更容易判断时间表是否真正可执行。" };
}
