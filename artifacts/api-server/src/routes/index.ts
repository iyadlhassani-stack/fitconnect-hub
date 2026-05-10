import { Router, type IRouter } from "express";
import healthRouter from "./health";
import aiRouter from "./ai";
import logsRouter from "./logs";
import walkRouter from "./walk";
import notificationsRouter from "./notifications";

const router: IRouter = Router();

router.use(healthRouter);
router.use(aiRouter);
router.use(logsRouter);
router.use(walkRouter);
router.use(notificationsRouter);

export default router;
