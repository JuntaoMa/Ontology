import { lstat, readdir, readFile, realpath, stat } from "node:fs/promises";
import path from "node:path";
import {
  Ajv2020,
  type ErrorObject,
  type ValidateFunction,
} from "ajv/dist/2020.js";
import { parseDocument } from "yaml";
import { DATASET_V1_SCHEMA } from "./dataset-schema.js";
import {
  assertPathInside,
  inspectTree,
  sha256File,
  type TreeSummary,
} from "./safe-files.js";

const DATASET_FILENAME = "dataset.yaml";
const MAX_DATASET_BYTES = 64 * 1024;
const MAX_CATALOG_DATASETS = 1_024;
const DATASET_TREE_LIMITS = {
  maxFiles: 50_000,
  maxTotalBytes: 20 * 1024 * 1024 * 1024,
  maxFileBytes: 4 * 1024 * 1024 * 1024,
  maxDepth: 32,
} as const;
const ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export interface DatasetV1 {
  schema_version: 1;
  id: string;
  title: string;
  description: string;
  ontology_file: string;
  raw_data_dir?: "raw_data";
}

export interface LoadedDataset {
  id: string;
  title: string;
  description: string;
  datasetPath: string;
  datasetRoot: string;
  ontologyFile: string;
  ontologyPath: string;
  ontologySha256: string;
  snapshotSha256: string;
  rawDataDir?: string;
}

export interface PublicDataset {
  id: string;
  title: string;
  description: string;
  ontology_sha256: string;
}

export interface LoadDatasetOptions {
  enforceDirectoryId?: boolean;
  signal?: AbortSignal;
}

export class DatasetValidationError extends Error {
  readonly datasetPath?: string;

  constructor(message: string, datasetPath?: string, options?: ErrorOptions) {
    super(datasetPath ? `${datasetPath}: ${message}` : message, options);
    this.name = "DatasetValidationError";
    this.datasetPath = datasetPath;
  }
}

const ajv = new Ajv2020({
  allErrors: true,
  strict: true,
  allowUnionTypes: false,
});
ajv.addSchema(DATASET_V1_SCHEMA);
const validateDataset = ajv.getSchema(DATASET_V1_SCHEMA.$id) as ValidateFunction;

export async function loadDatasetCatalog(
  datasetsRoot: string,
): Promise<LoadedDataset[]> {
  const root = await canonicalDirectory(datasetsRoot, "Dataset catalog root");
  const entries = await readdir(root, { withFileTypes: true });
  const candidates = entries
    .filter((entry) => !entry.name.startsWith(".") && !entry.name.startsWith("_"))
    .sort((left, right) => left.name.localeCompare(right.name));
  if (candidates.length > MAX_CATALOG_DATASETS) {
    throw new DatasetValidationError(
      `Dataset catalog exceeds ${MAX_CATALOG_DATASETS} datasets`,
      root,
    );
  }

  const datasets: LoadedDataset[] = [];
  for (const entry of candidates) {
    const entryPath = path.join(root, entry.name);
    if (entry.isSymbolicLink()) {
      throw new DatasetValidationError(
        "Dataset catalog must not contain symbolic links",
        entryPath,
      );
    }
    if (!entry.isDirectory()) continue;
    if (!ID_PATTERN.test(entry.name)) {
      throw new DatasetValidationError(
        "Dataset directory name must be a lowercase kebab id",
        entryPath,
      );
    }
    const datasetPath = path.join(entryPath, DATASET_FILENAME);
    let datasetStats;
    try {
      datasetStats = await lstat(datasetPath);
    } catch (error) {
      if (isNodeError(error) && error.code === "ENOENT") continue;
      throw error;
    }
    if (datasetStats.isSymbolicLink() || !datasetStats.isFile()) {
      throw new DatasetValidationError(
        "dataset.yaml must be a regular non-symlink file",
        datasetPath,
      );
    }
    datasets.push(await loadDataset(datasetPath, root));
  }
  return datasets.sort((left, right) => left.id.localeCompare(right.id));
}

export async function loadDataset(
  datasetPath: string,
  datasetsRoot: string,
  options: LoadDatasetOptions = {},
): Promise<LoadedDataset> {
  const catalogRoot = await canonicalDirectory(datasetsRoot, "Dataset catalog root");
  const requestedDatasetPath = path.resolve(datasetPath);
  await assertRegularFileWithoutSymlink(requestedDatasetPath, "Dataset manifest");
  const absoluteDatasetPath = await realpath(requestedDatasetPath);
  assertPathInside(
    catalogRoot,
    absoluteDatasetPath,
    "Dataset manifest must be inside the Dataset catalog",
  );
  const datasetRoot = await canonicalDirectory(
    path.dirname(absoluteDatasetPath),
    "Dataset root",
  );
  assertPathInside(
    catalogRoot,
    datasetRoot,
    "Dataset root must be inside the Dataset catalog",
    true,
  );

  const source = parseDatasetYaml(
    await readTextFileLimited(
      absoluteDatasetPath,
      MAX_DATASET_BYTES,
      "Dataset manifest",
    ),
    absoluteDatasetPath,
  );
  validateDatasetObject(source, absoluteDatasetPath);
  if (
    options.enforceDirectoryId !== false &&
    path.basename(datasetRoot) !== source.id
  ) {
    throw new DatasetValidationError(
      "Dataset id must match its directory name",
      absoluteDatasetPath,
    );
  }

  let tree: TreeSummary;
  try {
    tree = await inspectTree(
      datasetRoot,
      DATASET_TREE_LIMITS,
      options.signal,
    );
  } catch (error) {
    throw new DatasetValidationError(
      "Dataset tree contains an unsafe entry",
      absoluteDatasetPath,
      { cause: error },
    );
  }
  const ontologyPath = path.join(datasetRoot, source.ontology_file);
  assertPathInside(
    datasetRoot,
    ontologyPath,
    "Ontology file must remain inside the Dataset",
    true,
  );
  if (path.dirname(ontologyPath) !== datasetRoot) {
    throw new DatasetValidationError(
      "ontology_file must be a direct child of the Dataset root",
      absoluteDatasetPath,
    );
  }
  await assertRegularFileWithoutSymlink(ontologyPath, "Ontology");

  let rawDataDir: string | undefined;
  if (source.raw_data_dir) {
    rawDataDir = await canonicalDirectory(
      path.join(datasetRoot, source.raw_data_dir),
      "raw_data",
    );
    if (path.dirname(rawDataDir) !== datasetRoot) {
      throw new DatasetValidationError(
        "raw_data must be a direct child of the Dataset root",
        absoluteDatasetPath,
      );
    }
  }

  return {
    id: source.id,
    title: source.title,
    description: source.description,
    datasetPath: absoluteDatasetPath,
    datasetRoot,
    ontologyFile: source.ontology_file,
    ontologyPath: await realpath(ontologyPath),
    ontologySha256: await sha256File(ontologyPath, options.signal),
    snapshotSha256: tree.sha256,
    ...(rawDataDir ? { rawDataDir } : {}),
  };
}

export function toPublicDataset(dataset: LoadedDataset): PublicDataset {
  return {
    id: dataset.id,
    title: dataset.title,
    description: dataset.description,
    ontology_sha256: dataset.ontologySha256,
  };
}

function parseDatasetYaml(datasetText: string, datasetPath: string): unknown {
  const document = parseDocument(datasetText, {
    schema: "core",
    uniqueKeys: true,
    prettyErrors: false,
  });
  if (document.errors.length > 0 || document.warnings.length > 0) {
    throw new DatasetValidationError(
      `YAML parsing failed: ${[
        ...document.errors,
        ...document.warnings,
      ].map((error) => error.message).join("; ")}`,
      datasetPath,
    );
  }
  try {
    return document.toJS({ maxAliasCount: 0 });
  } catch (error) {
    throw new DatasetValidationError(
      "YAML aliases are not allowed in Dataset manifests",
      datasetPath,
      { cause: error },
    );
  }
}

function validateDatasetObject(
  value: unknown,
  datasetPath: string,
): asserts value is DatasetV1 {
  if (!validateDataset(value)) {
    throw new DatasetValidationError(
      `Dataset schema validation failed: ${formatAjvErrors(validateDataset.errors)}`,
      datasetPath,
    );
  }
}

async function assertRegularFileWithoutSymlink(
  filePath: string,
  label: string,
): Promise<void> {
  let fileStats;
  try {
    fileStats = await lstat(filePath);
  } catch (error) {
    throw new DatasetValidationError(`${label} file does not exist`, filePath, {
      cause: error,
    });
  }
  if (fileStats.isSymbolicLink() || !fileStats.isFile()) {
    throw new DatasetValidationError(
      `${label} must be a regular non-symlink file`,
      filePath,
    );
  }
}

async function canonicalDirectory(directory: string, label: string): Promise<string> {
  const absolute = path.resolve(directory);
  let entryStats;
  try {
    entryStats = await lstat(absolute);
  } catch (error) {
    throw new DatasetValidationError(`${label} does not exist`, absolute, {
      cause: error,
    });
  }
  if (entryStats.isSymbolicLink() || !entryStats.isDirectory()) {
    throw new DatasetValidationError(
      `${label} must be a non-symlink directory`,
      absolute,
    );
  }
  return realpath(absolute);
}

async function readTextFileLimited(
  filePath: string,
  maxBytes: number,
  label: string,
): Promise<string> {
  const fileStats = await stat(filePath);
  if (fileStats.size > maxBytes) {
    throw new DatasetValidationError(`${label} exceeds ${maxBytes} bytes`, filePath);
  }
  const contents = await readFile(filePath);
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(contents);
  } catch (error) {
    throw new DatasetValidationError(`${label} is not valid UTF-8`, filePath, {
      cause: error,
    });
  }
}

function formatAjvErrors(errors: ErrorObject[] | null | undefined): string {
  if (!errors || errors.length === 0) return "unknown schema error";
  return errors
    .map((error) => `${error.instancePath || "/"} ${error.message ?? "is invalid"}`)
    .join("; ");
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}
