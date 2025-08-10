import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn } from 'typeorm'

@Entity('tasks')
export class TaskEntity {
  @PrimaryGeneratedColumn()
  id: number

  @Column({ type: 'varchar', length: 255 })
  name: string

  @Column({ type: 'text', nullable: true })
  description: string

  @Column({ type: 'varchar', length: 100 })
  platform: string

  @Column({ type: 'simple-array' })
  keywords: string[]

  @Column({ type: 'varchar', length: 255, nullable: true })
  location: string

  @Column({ type: 'int', default: 10 })
  numPages: number

  @Column({ type: 'int', default: 3 })
  concurrency: number

  @Column({ type: 'boolean', default: true })
  showBrowser: boolean

  @Column({ 
    type: 'varchar', 
    length: 20, 
    default: 'pending',
    enum: ['pending', 'running', 'completed', 'failed', 'cancelled']
  })
  status: string

  @Column({ type: 'int', default: 0 })
  results_count: number

  @Column({ type: 'text', nullable: true })
  error_message: string

  @CreateDateColumn()
  created_at: string

  @UpdateDateColumn()
  updated_at: string

  @Column({ type: 'datetime', nullable: true })
  completed_at: string
}
