-- CreateTable
CREATE TABLE `EventDailyStat` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `date` DATE NOT NULL,
    `name` VARCHAR(100) NOT NULL,
    `count` INTEGER NOT NULL,
    `uniqueSessions` INTEGER NOT NULL,
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `EventDailyStat_date_idx`(`date`),
    UNIQUE INDEX `EventDailyStat_date_name_key`(`date`, `name`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
