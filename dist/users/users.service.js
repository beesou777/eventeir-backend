"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.UsersService = void 0;
const common_1 = require("@nestjs/common");
const prisma_service_1 = require("../prisma/prisma.service");
const argon2 = require("argon2");
const library_1 = require("@prisma/client/runtime/library");
const jwt_1 = require("@nestjs/jwt");
const config_1 = require("@nestjs/config");
const uuid_1 = require("uuid");
const send_reset_password_1 = require("./services/send-reset-password");
const moment = require("moment");
let UsersService = class UsersService {
    constructor(prisma, jwt, config, mailService) {
        this.prisma = prisma;
        this.jwt = jwt;
        this.config = config;
        this.mailService = mailService;
    }
    async createUser(data) {
        try {
            const hash = await argon2.hash(data.password);
            data.password = hash;
            const user = this.prisma.user.create({
                data: {
                    email: data.email,
                    name: data.name,
                    companyName: data.companyName,
                    password: data.password,
                    role: data.role,
                },
            });
            delete (await user).password;
            return user;
        }
        catch (error) {
            if (error instanceof library_1.PrismaClientKnownRequestError) {
                if (error.code === 'P2002') {
                    throw new common_1.ForbiddenException('Credentials taken');
                }
            }
        }
    }
    async signIn(dto) {
        const user = await this.prisma.user.findUnique({
            where: {
                email: dto.email
            }
        });
        if (!user)
            throw new common_1.ForbiddenException('Credentials incorrect');
        if (user.isUserBlocked && user.blockedAt) {
            const unblockTime = moment(user.blockedAt).add(8, 'hours');
            if (moment().isAfter(unblockTime)) {
                await this.prisma.user.update({
                    where: { id: user.id },
                    data: {
                        isUserBlocked: false,
                        blockedAt: null,
                    }
                });
            }
            else {
                throw new common_1.ForbiddenException('User is temporarily blocked. Try again later.');
            }
        }
        const pwMatches = await argon2.verify(user.password, dto.password);
        if (!pwMatches) {
            const updatedAttempts = (user.failedAttempts || 0) + 1;
            const isUserBlocked = updatedAttempts >= 10;
            await this.prisma.user.update({
                where: { id: user.id },
                data: {
                    failedAttempts: updatedAttempts,
                    isUserBlocked,
                    blockedAt: isUserBlocked ? new Date() : null
                }
            });
            if (isUserBlocked) {
                throw new common_1.ForbiddenException('User account blocked due to multiple failed login attempts');
            }
            throw new common_1.UnauthorizedException('Invalid credentials');
        }
        await this.prisma.user.update({
            where: { id: user.id },
            data: {
                failedAttempts: 0,
                isUserBlocked: false,
                blockedAt: null
            }
        });
        return this.signToken(user.id, user.email, user.role);
    }
    async signToken(userId, email, role) {
        const payload = {
            sub: userId,
            email,
            role
        };
        const secret = this.config.get('JWT_SECRET');
        const token = await this.jwt.signAsync(payload, {
            expiresIn: '7d',
            secret
        });
        return {
            access_token: token
        };
    }
    async verifyToken(token) {
        try {
            const secret = this.config.get('JWT_SECRET');
            const user = await this.jwt.verify(token, {
                secret
            });
            return user;
        }
        catch (error) {
            return null;
        }
    }
    async updateUser(id, data) {
        if (!id && data)
            throw new common_1.ForbiddenException('User ID not found');
        const updateData = {
            ...(data.name && { name: data.name }),
            ...(data.companyName && { companyName: data.companyName }),
        };
        return this.prisma.user.update({
            where: { id },
            data: updateData,
        });
    }
    async getUserProfile(userId) {
        const profile = await this.prisma.user.findUnique({
            where: { id: userId },
        });
        if (!profile)
            throw new common_1.ForbiddenException('User not found');
        delete profile.password;
        return profile;
    }
    async changePassword(userId, dto) {
        if (!userId && dto)
            throw new common_1.ForbiddenException('User ID not found');
        const user = await this.prisma.user.findUnique({
            where: { id: userId },
        });
        if (!user)
            throw new common_1.ForbiddenException('User not found');
        const pwMtches = await argon2.verify(user.password, dto.currentPassword);
        if (!pwMtches)
            throw new common_1.ForbiddenException('Current Password not correct');
        if (dto.newPassword !== dto.confirmPassword)
            throw new common_1.ForbiddenException('Password not match');
        const hash = await argon2.hash(dto.newPassword);
        const updateUser = this.prisma.user.update({
            where: { id: userId },
            data: { password: hash }
        });
        delete (await updateUser).password;
        return updateUser;
    }
    async forgotPassword(dto) {
        if (!dto.email)
            throw new common_1.ForbiddenException('Email not found');
        const token = (0, uuid_1.v4)();
        const user = await this.prisma.user.findUnique({ where: { email: dto.email } });
        if (!user)
            throw new common_1.ForbiddenException('User not found');
        await this.prisma.resetPasswordToken.create({
            data: {
                token: token,
                userId: user.id,
                expiresAt: new Date(Date.now() + 1000 * 60 * 60 * 1)
            }
        });
        await this.mailService.sendPasswordResetEmail(user.email, token);
    }
    async resetPassword(dto) {
        if (dto.newPassword !== dto.confirmPassword)
            throw new common_1.ForbiddenException('Password not match');
        const getUserData = await this.prisma.resetPasswordToken.findUnique({
            where: { token: dto.token }
        });
        const newPassword = await argon2.hash(dto.newPassword);
        if (getUserData?.expiresAt < new Date() || !getUserData)
            throw new common_1.ForbiddenException('Token is exipre or invalid');
        const user = await this.prisma.user.update({
            where: { id: getUserData.userId },
            data: { password: newPassword }
        });
        await this.prisma.resetPasswordToken.update({
            where: { token: dto.token },
            data: { isValid: false }
        });
        await this.prisma.resetPasswordToken.delete({
            where: { token: dto.token }
        });
        delete user.password;
        return user;
    }
};
exports.UsersService = UsersService;
exports.UsersService = UsersService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService,
        jwt_1.JwtService,
        config_1.ConfigService,
        send_reset_password_1.MailService])
], UsersService);
//# sourceMappingURL=users.service.js.map