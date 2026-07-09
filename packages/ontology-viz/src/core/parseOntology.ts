import {
  getExplicitOntologyDefaultDescription,
  getExplicitOntologyDefaultLabel,
  getExplicitOntologyDisplayValue,
  getExplicitOntologyFieldValues,
  parseExplicitOntology,
} from "../lib/explicitOntologyParser";
import type { OntologyEntity, OntologyGraphData, OntologyParseOptions } from "./types";

export function parseOntology(
  content: string,
  options: OntologyParseOptions = {},
): OntologyGraphData {
  return parseExplicitOntology(content, options);
}

export function getOntologyFieldValues(entity: OntologyEntity, fieldId: string): string[] {
  return getExplicitOntologyFieldValues(entity, fieldId);
}

export function getOntologyDisplayValue(entity: OntologyEntity, fieldId: string) {
  return getExplicitOntologyDisplayValue(entity, fieldId);
}

export function getOntologyDefaultLabel(entity: OntologyEntity) {
  return getExplicitOntologyDefaultLabel(entity);
}

export function getOntologyDefaultDescription(entity: OntologyEntity) {
  return getExplicitOntologyDefaultDescription(entity);
}
