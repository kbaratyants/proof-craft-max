export abstract class UserNotificationGateway {
  abstract send(maxUserId: number, message: string): Promise<void>
}
