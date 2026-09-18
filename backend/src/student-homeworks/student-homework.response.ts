import type { FileReferenceService } from '../storage/file-reference.service.js'
import type { StudentHomework, StudentHomeworkReview } from './student-homeworks.repository.js'

const reviewResponse = (review: StudentHomeworkReview) => ({
  id: review.id,
  teacher_id: review.teacherId,
  teacher_name: review.teacherName,
  rating: review.rating,
  comment: review.comment,
  status: review.status,
  created_at: review.createdAt,
})

/**
 * Карточка работы для клиента. Порядок полей — часть контракта API.
 * `withReviewCount: false` — ответ на исправление: в нём нет `review_count`.
 */
export function studentHomeworkResponse(
  homework: StudentHomework,
  files: FileReferenceService,
  { withReviewCount = true } = {},
): object {
  const primaryFile = files.hasFile(homework.fileId)
  const revisionFile = files.hasFile(homework.revisionStudentFileId)
  const reviews = homework.reviews.map(reviewResponse)
  const attachments = homework.attachments.map((attachment) => {
    const availability = files.hasFile(attachment.fileId)
    return {
      id: attachment.id,
      content_type: attachment.contentType,
      has_file: availability,
    }
  })
  return {
    id: homework.id,
    student_id: homework.studentId,
    lesson_number: homework.lessonNumber,
    is_bonus: homework.isBonus,
    haircut_name: homework.haircutName,
    has_file: primaryFile,
    status: homework.status,
    content_type: homework.contentType,
    file_id: homework.fileId,
    text_content: homework.textContent,
    ...(withReviewCount ? { review_count: reviews.length } : {}),
    created_at: homework.createdAt,
    revision_student_text: homework.revisionStudentText,
    revision_has_file: revisionFile,
    reviews,
    latest_review: reviews[0] || null,
    comments: homework.comments.map((comment) => ({
      id: comment.id,
      author_user_id: comment.authorUserId,
      author_name: comment.authorName,
      author_role: comment.authorRole,
      text_content: comment.textContent,
      created_at: comment.createdAt,
    })),
    extra_files_count: attachments.length,
    attachments,
  }
}
