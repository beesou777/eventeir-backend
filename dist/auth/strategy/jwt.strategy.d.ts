import { ConfigService } from "@nestjs/config";
import { PrismaService } from "src/prisma/prisma.service";
declare const JwtStrategy_base: new (...args: any[]) => any;
export declare class JwtStrategy extends JwtStrategy_base {
    private prisma;
    constructor(config: ConfigService, prisma: PrismaService);
    validate(playload: {
        sub: number;
        email: string;
    }): Promise<{
        email: string;
        password: string;
        name: string;
        companyName: string | null;
        id: number;
        role: import(".prisma/client").$Enums.UserRole;
        createdAt: Date;
        updatedAt: Date;
    }>;
}
export {};
