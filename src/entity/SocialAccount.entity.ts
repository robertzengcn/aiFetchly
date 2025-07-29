import { Entity, PrimaryGeneratedColumn, Column, ManyToMany, JoinTable } from 'typeorm';
import AuditableEntity from "@/entity/Auditable.entity";
import { ProxyEntity } from "@/entity/Proxy.entity";

@Entity('social_accounts')
export class SocialAccountEntity extends AuditableEntity {
  @PrimaryGeneratedColumn()
  id: number;

  // @Column({ type: 'varchar', length: 100,nullable: true })
  // social_type: string;

  @Column({ type: 'integer' })
  social_type_id: number;

  // @Column({ type: 'varchar', length: 255, nullable: true })
  // social_type_url: string;

  @Column({ type: 'varchar', length: 255 })
  user: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  pass: string;

  @Column({ type: 'integer', default: 1 })
  status: number;

  @Column({ type: 'varchar', length: 255 })
  name: string;

  @Column({ type: 'varchar', length: 50, nullable: true })
  phone: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  email: string;

  @ManyToMany(() => ProxyEntity)
  @JoinTable({
    name: 'social_account_proxies',
    joinColumn: {
      name: 'social_account_id',
      referencedColumnName: 'id'
    },
    inverseJoinColumn: {
      name: 'proxy_id',
      referencedColumnName: 'id'
    }
  })
  proxy: ProxyEntity[];
} 