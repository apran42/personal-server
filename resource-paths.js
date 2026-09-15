function createResourcePathUpdater(db) {
  if (!db) {
    throw new Error("Database connection is required");
  }

  const listResources = db.prepare(`
    SELECT id, file_path
    FROM resources
  `);

  const updateResource = db.prepare(`
    UPDATE resources
    SET
      file_path = ?,
      updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `);

  return function updateResourcePaths({
    sourcePath,
    destinationPath,
    isDirectory
  }) {
    if (
      typeof sourcePath !== "string" ||
      typeof destinationPath !== "string" ||
      !sourcePath ||
      !destinationPath
    ) {
      throw new Error("Valid source and destination paths are required");
    }

    const changes = listResources
      .all()
      .filter((resource) => {
        if (resource.file_path === sourcePath) {
          return true;
        }

        return isDirectory && resource.file_path.startsWith(`${sourcePath}/`);
      })
      .map((resource) => ({
        id: resource.id,
        filePath:
          resource.file_path === sourcePath
            ? destinationPath
            : `${destinationPath}${resource.file_path.slice(sourcePath.length)}`
      }));

    if (changes.length === 0) {
      return 0;
    }

    db.exec("BEGIN IMMEDIATE");

    try {
      for (const change of changes) {
        updateResource.run(change.filePath, change.id);
      }

      db.exec("COMMIT");
      return changes.length;
    } catch (error) {
      try {
        db.exec("ROLLBACK");
      } catch {
        // 원래 데이터베이스 오류를 유지합니다.
      }

      throw error;
    }
  };
}

module.exports = createResourcePathUpdater;
