package tryon

const portraitPromptPrefix = "Create one full-body studio portrait of the adult companion."

var portraitPoses = map[string]string{
	"natural": "standing naturally with relaxed arms and a warm expression",
	"wave":    "standing and giving a small friendly wave with one hand",
	"heart":   "standing and forming a small heart with both hands near the chest",
	"peace":   "standing and making a peace sign beside the face",
	"sitting": "sitting gracefully with a relaxed posture and hands resting naturally",
	"profile": "standing in a three-quarter profile and gently looking back at the camera",
}

// ValidPoseID recognizes only explicit selections in the fixed catalog.
func ValidPoseID(id string) bool {
	_, ok := portraitPoses[id]
	return ok
}

func buildPortraitPrompt(id string) string {
	return portraitPromptPrefix + " Preserve the adult identity, face, skin tone and hairstyle from Picture 1. " +
		"Use Picture 2 only for the complete clothing and accessories; preserve its design and colors. " +
		"Do not copy either reference's pose, crop or background. Pose: " + portraitPoses[id] + ". " +
		"Frame the clothed person from head to shoes, with natural anatomy, clean studio lighting and no text. Return the final image only."
}
