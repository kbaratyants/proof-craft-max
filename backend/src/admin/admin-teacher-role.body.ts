import type { AuthenticationRequest } from '../auth/auth.types.js'
import { invalidParameters } from '../common/invalid-parameters.error.js'

export type AdminTeacherRoleAction = 'assign' | 'remove'

export type ChangeAdminTeacherRoleCommand = {
  targetMaxUserId: number
  action: AdminTeacherRoleAction
  fullName?: string
}

export type AdminTeacherRoleRequest = AuthenticationRequest & {
  adminTeacherRoleCommand?: ChangeAdminTeacherRoleCommand
}

export const parseAdminTeacherRole = (
  rawBody: unknown,
): ChangeAdminTeacherRoleCommand => {
  if (!rawBody || typeof rawBody !== 'object' || Array.isArray(rawBody)) {
    return invalidParameters()
  }
  const body = rawBody as Record<string, unknown>
  const targetMaxUserId = Number(body.target_max_user_id)
  if (
    !Number.isSafeInteger(targetMaxUserId) ||
    targetMaxUserId <= 0 ||
    !['assign', 'remove'].includes(String(body.action)) ||
    (body.full_name !== undefined && typeof body.full_name !== 'string')
  ) {
    return invalidParameters()
  }
  return {
    targetMaxUserId,
    action: body.action as AdminTeacherRoleAction,
    ...(body.full_name === undefined ? {} : { fullName: body.full_name }),
  }
}

export const adminTeacherRoleCommandFrom = (
  request: AdminTeacherRoleRequest,
): ChangeAdminTeacherRoleCommand =>
  request.adminTeacherRoleCommand ?? invalidParameters()
